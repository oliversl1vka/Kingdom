import type {
  IncidentReport,
  HealerDiagnosis,
  HealerRecommendation,
  ProviderAdapter,
  CompletionRequest,
} from '@kingdomos/core';
import { IncidentReporter } from './incident-reporter.js';
import type Database from 'better-sqlite3';

export class Diagnostician {
  private reporter: IncidentReporter;

  constructor(
    private db: Database.Database,
    private provider: ProviderAdapter
  ) {
    this.reporter = new IncidentReporter(db);
  }

  async diagnose(incident: IncidentReport): Promise<HealerDiagnosis> {
    const prompt = `You are an AI diagnostician analyzing a software development failure.

Incident Details:
- Task ID: ${incident.task_id}
- Severity: ${incident.severity}
- Failure Type: ${incident.failure_type}
- Symptoms: ${JSON.stringify(incident.symptoms)}
- Context: ${incident.context_summary}
- Failure History: ${JSON.stringify(incident.failure_history)}

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
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.2,
    });

    const diagnosis = this.parseResponse(incident.id, response.content);

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
