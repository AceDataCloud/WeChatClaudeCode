import { readdirSync, readFileSync, existsSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../logger.js';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
}

/**
 * Parse YAML-like frontmatter from a SKILL.md file.
 * Only extracts `name` and `description` fields.
 */
function parseSkillMd(filePath: string): { name: string; description: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const frontmatter = match[1];
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

    if (!nameMatch) return null;

    return {
      name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
      description: descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : '',
    };
  } catch {
    logger.warn(`Failed to read SKILL.md: ${filePath}`);
    return null;
  }
}

/**
 * Scan a directory for SKILL.md files, reading skill info from each.
 */
function scanDirectory(baseDir: string, depth: number = 2): SkillInfo[] {
  const skills: SkillInfo[] = [];

  if (!existsSync(baseDir)) return skills;

  let entries: Dirent[];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(baseDir, entry.name);

    if (depth > 1) {
      // Recurse one level deeper
      skills.push(...scanDirectory(fullPath, depth - 1));
    }

    const skillFile = join(fullPath, 'SKILL.md');
    if (existsSync(skillFile)) {
      const info = parseSkillMd(skillFile);
      if (info) {
        skills.push({ ...info, path: fullPath });
      }
    }
  }

  return skills;
}

/**
 * Scan all known skill directories for installed Claude Code skills.
 *
 * Locations scanned:
 * 1. ~/.claude/skills/ (each subdirectory)
 * 2. ~/.claude/plugins/cache/{plugin}/skills/ (each subdirectory)
 * 3. ~/.claude/plugins/cache/{plugin}/superpowers/skills/ (each subdirectory)
 */
export function scanAllSkills(): SkillInfo[] {
  const home = homedir();
  const claudeDir = join(home, '.claude');
  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  // 1. ~/.claude/skills/*/
  const userSkillsDir = join(claudeDir, 'skills');
  for (const skill of scanDirectory(userSkillsDir, 1)) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  // 2. ~/.claude/plugins/cache/*/skills/*/
  const pluginsCacheDir = join(claudeDir, 'plugins', 'cache');
  if (existsSync(pluginsCacheDir)) {
    let cacheEntries: Dirent[];
    try {
      cacheEntries = readdirSync(pluginsCacheDir, { withFileTypes: true });
    } catch {
      cacheEntries = [];
    }

    for (const cacheEntry of cacheEntries) {
      if (!cacheEntry.isDirectory()) continue;
      const cacheDir = join(pluginsCacheDir, cacheEntry.name);

      // Regular skills
      const pluginSkillsDir = join(cacheDir, 'skills');
      for (const skill of scanDirectory(pluginSkillsDir, 1)) {
        if (!seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }

      // Superpowers skills
      const superpowersSkillsDir = join(cacheDir, 'superpowers', 'skills');
      for (const skill of scanDirectory(superpowersSkillsDir, 1)) {
        if (!seen.has(skill.name)) {
          seen.add(skill.name);
          skills.push(skill);
        }
      }
    }
  }

  logger.info(`Scanned ${skills.length} skills`);
  return skills;
}

/**
 * Format a list of skills into a readable string for display.
 */
export function formatSkillList(skills: SkillInfo[]): string {
  if (skills.length === 0) {
    return 'No skills found.';
  }

  const lines = skills.map((s, i) => {
    const desc = s.description ? ` - ${s.description}` : '';
    return `  ${i + 1}. ${s.name}${desc}`;
  });

  return `Available skills (${skills.length}):\n${lines.join('\n')}`;
}

/**
 * Find a skill by name (case-insensitive match).
 */
export function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
  const lower = name.toLowerCase();
  return skills.find(
    (s) => s.name.toLowerCase() === lower || s.name.toLowerCase().replace(/\s+/g, '-') === lower,
  );
}
