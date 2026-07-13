import type {
  IncidentReport,
  HealerDiagnosis,
  HealerRecommendation,
  ProviderAdapter,
  CompletionRequest,
  ModelResolver,
  ModelCapabilities,
} from '@kingdomos/core';
import { LessonsRepository } from '@kingdomos/core';
import { IncidentReporter } from './incident-reporter.js';
import { runAgenticDiagnosis, type AgenticHealerContext } from './agentic-healer.js';
import { calibrateConfidence } from './calibration.js';
import type Database from 'better-sqlite3';

/**
 * PHASE3 (P3.3): optional hooks that turn the Diagnostician into an
 * execution-grounded agent when the model supports tool-use. All optional —
 * absent ⇒ today's one-shot classifier path (unchanged).
 */
export interface DiagnosticianOptions {
  /** Resolve a model's capabilities. tool_use === true unlocks the agentic loop. */
  capabilitiesResolver?: (model: string) => ModelCapabilities | null;
  /** Workspace + whitelisted commands for the agentic tool loop. */
  agenticContext?: AgenticHealerContext;
  verbose?: boolean;
}

export class Diagnostician {
  private reporter: IncidentReporter;
  private readonly staticModel: string;
  private readonly resolver?: ModelResolver;
  private readonly options: DiagnosticianOptions;

  constructor(
    private db: Database.Database,
    private provider: ProviderAdapter,
    modelOrResolver: string | ModelResolver = 'gpt-4.1-mini',
    options: DiagnosticianOptions = {},
  ) {
    this.reporter = new IncidentReporter(db);
    this.options = options;
    if (typeof modelOrResolver === 'function') {
      this.resolver = modelOrResolver;
      this.staticModel = 'gpt-4.1-mini';
    } else {
      this.staticModel = modelOrResolver;
    }
  }

  /**
   * The model id this diagnostician will use on the *next* diagnose() call.
   * Honors the resolver first, falls back to the static id. Public so
   * operators and tests can inspect which model is about to run.
   */
  getEffectiveModel(): string {
    if (this.resolver) {
      try { return this.resolver(); } catch { /* fall through */ }
    }
    return this.staticModel;
  }

  /** Internal alias so existing `this.model` readers compile. */
  private get model(): string { return this.getEffectiveModel(); }

  async diagnose(incident: IncidentReport): Promise<HealerDiagnosis> {
    // Pull up to 5 prior lessons matching this incident's failure_type. These
    // are durable cross-run patterns (e.g. "repeated token-overflow on squire
    // → escalate earlier"). Best-effort: if the lessons table doesn't exist
    // or the query throws, proceed without lessons.
    let pastLessonsBlock = '';
    if (process.env.KINGDOM_NO_LESSONS !== '1') {
      try {
        const lessons = new LessonsRepository(this.db).listByFailureType(incident.failure_type, 5);
        if (lessons.length > 0) {
          const rendered = lessons
            .map((l) => `- (${l.rule_id}, seen ${l.times_seen}×) ${l.title}\n  ${l.body}`)
            .join('\n');
          pastLessonsBlock = `\n\nPast lessons for failure_type="${incident.failure_type}":\n${rendered}\n\nConsider these patterns when choosing an action.`;
        }
      } catch {
        // Pre-migration DB — skip silently.
      }
    }

    // PHASE3 (P3.3): when the healer model supports native tool-use AND we have
    // a workspace context, run the bounded execution-grounded agentic loop. It
    // can reproduce/inspect the failure and propose a verified `repair` patch.
    // Otherwise fall through to the one-shot classifier (weak-model path).
    const caps = this.options.capabilitiesResolver?.(this.model) ?? null;
    if (caps?.tool_use && this.options.agenticContext) {
      try {
        const diagnosis = await runAgenticDiagnosis(
          incident,
          this.options.agenticContext,
          { provider: this.provider, model: this.model, verbose: this.options.verbose },
          pastLessonsBlock,
        );
        this.reporter.updateDiagnosis(incident.id, diagnosis.probable_cause, diagnosis.confidence, diagnosis.recommendation);
        return diagnosis;
      } catch (err) {
        if (this.options.verbose) {
          console.error(`[Diagnostician] agentic loop failed, falling back to classifier: ${(err as Error).message}`);
        }
        // fall through to classifier on any agentic-loop error
      }
    }

    const prompt = `You are an AI diagnostician analyzing a software development failure.

Incident Details:
- Task ID: ${incident.task_id}
- Severity: ${incident.severity}
- Failure Type: ${incident.failure_type}
- Symptoms: ${JSON.stringify(incident.symptoms)}
- Context: ${incident.context_summary}
- Failure History: ${JSON.stringify(incident.failure_history)}${pastLessonsBlock}

Analyze the root cause and provide a recommendation.
Respond with JSON:
{
  "probable_cause": "string",
  "confidence": 0.0-1.0,
  "recommendation": {
    "action": "retry|decompose|reassign|escalate",
    ... action-specific fields
  }
}

Rules:
- If confidence < 0.5, action MUST be "escalate"
- For "retry": include "modifications" field
- For "decompose": include "new_subtasks" array
- For "reassign": include "target_tier" and "reason"
- For "escalate": include "message"`;

    const response = await this.provider.complete({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.2,
    });

    const diagnosis = this.parseResponse(incident.id, response.content);

    // PHASE4 (P4.5): calibrate the raw self-reported confidence against the
    // Healer's historical accuracy before applying the escalate gate. Degrades to
    // a neutral 1.0 multiplier (unchanged) until there is enough history to judge.
    diagnosis.confidence = calibrateConfidence(this.db, diagnosis.confidence);

    // Enforce confidence < 0.5 → escalate rule
    if (diagnosis.confidence < 0.5 && diagnosis.recommendation.action !== 'escalate') {
      diagnosis.recommendation = { action: 'escalate', message: `Low confidence diagnosis (${diagnosis.confidence}): ${diagnosis.probable_cause}` };
    }

    // Persist diagnosis
    this.reporter.updateDiagnosis(
      incident.id,
      diagnosis.probable_cause,
      diagnosis.confidence,
      diagnosis.recommendation
    );

    return diagnosis;
  }

  private parseResponse(incidentId: string, content: string): HealerDiagnosis {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        incident_id: incidentId,
        probable_cause: String(parsed.probable_cause ?? 'Unknown'),
        confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0))),
        recommendation: parsed.recommendation as HealerRecommendation,
      };
    } catch {
      return {
        incident_id: incidentId,
        probable_cause: 'Failed to diagnose: unparseable response',
        confidence: 0,
        recommendation: { action: 'escalate', message: 'Diagnosis failed — manual intervention required' },
      };
    }
  }
}
