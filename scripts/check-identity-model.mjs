import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = new URL('../public/models/', import.meta.url);
const source = JSON.parse(await readFile(new URL('identity-source.json', base), 'utf8'));
const data = await readFile(new URL(source.file, base));
if (data.length !== source.bytes || createHash('sha256').update(data).digest('hex') !== source.sha256) throw new Error('一致性模型文件或 SHA-256 不符，请恢复 identity-source.json 指定的原始模型');
