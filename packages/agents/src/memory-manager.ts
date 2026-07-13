import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AgentMemoryFile {
  agent_name: string;
  file_path: string;
  last_modified: string;
  content: string;
}

export class MemoryManager {
  private baseDir: string;

  constructor(kingdomDir: string) {
    this.baseDir = join(kingdomDir, 'memory');
  }

  private ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  private getAgentDir(agentName: string): string {
    return join(this.baseDir, agentName);
  }

  private getSharedDir(): string {
    return join(this.baseDir, 'shared');
  }

  read(agentName: string, fileName: string): AgentMemoryFile | null {
    const filePath = join(this.getAgentDir(agentName), fileName);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf8');
    return {
      agent_name: agentName,
      file_path: filePath,
      last_modified: new Date().toISOString(),
      content,
    };
  }

  write(agentName: string, fileName: string, content: string): void {
    const dir = this.getAgentDir(agentName);
    this.ensureDir(dir);
    writeFileSync(join(dir, fileName), content, 'utf8');
  }

  append(agentName: string, fileName: string, content: string): void {
    const dir = this.getAgentDir(agentName);
    this.ensureDir(dir);
    const filePath = join(dir, fileName);
    appendFileSync(filePath, `\n${content}`, 'utf8');
  }

  readShared(fileName: string): string | null {
    const filePath = join(this.getSharedDir(), fileName);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf8');
  }

  writeShared(fileName: string, content: string): void {
    const dir = this.getSharedDir();
    this.ensureDir(dir);
    writeFileSync(join(dir, fileName), content, 'utf8');
  }

  appendShared(fileName: string, content: string): void {
    const dir = this.getSharedDir();
    this.ensureDir(dir);
    appendFileSync(join(dir, fileName), `\n${content}`, 'utf8');
  }
}