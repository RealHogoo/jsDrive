import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class VersionService {
  version(): { service: string; revision: string } {
    return {
      service: process.env.SERVICE_ID || 'webhard-service',
      revision: process.env.GIT_REVISION || gitRevision() || 'unknown',
    };
  }
}

function gitRevision(): string | null {
  try {
    const gitDir = join(process.cwd(), '.git');
    const headPath = join(gitDir, 'HEAD');
    if (!existsSync(headPath)) {
      return null;
    }
    const head = readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.slice('ref:'.length).trim();
      const refPath = join(gitDir, ref);
      if (existsSync(refPath)) {
        return readFileSync(refPath, 'utf8').trim().slice(0, 7);
      }
      return null;
    }
    return head.slice(0, 7);
  } catch (exception) {
    return null;
  }
}
