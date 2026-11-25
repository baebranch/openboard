import { describe, expect, it } from 'vitest';
import { computeWorkspaceId, isAbsolutePathLike, isInside, normalizeFolderPath, normalizeFolders } from './workspace-id';

describe('normalizeFolderPath', () => {
  it('uses forward slashes, lowercases the drive and drops trailing slashes', () => {
    expect(normalizeFolderPath('C:\\Code\\Proj\\')).toBe('c:/Code/Proj');
    expect(normalizeFolderPath('c:/Code/Proj')).toBe('c:/Code/Proj');
    expect(normalizeFolderPath('/home/me/proj/')).toBe('/home/me/proj');
  });
  it('keeps roots', () => {
    expect(normalizeFolderPath('/')).toBe('/');
    expect(normalizeFolderPath('C:\\')).toBe('c:/');
    expect(normalizeFolderPath('C:')).toBe('c:/');
  });
  it('keeps UNC prefix', () => {
    expect(normalizeFolderPath('\\\\server\\share\\x\\')).toBe('//server/share/x');
  });
});

describe('computeWorkspaceId', () => {
  it('is 12 hex chars and stable', () => {
    const id = computeWorkspaceId(['C:\\a\\b'], 'inst');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(computeWorkspaceId(['C:\\a\\b'], 'other')).toBe(id);
  });
  it('ignores order, slash style, drive case, trailing slash and duplicates', () => {
    const a = computeWorkspaceId(['C:\\x\\one', 'C:\\x\\two'], 'i');
    expect(computeWorkspaceId(['c:/x/two/', 'c:/x/one', 'C:/x/one'], 'j')).toBe(a);
  });
  it('differs for different folders', () => {
    expect(computeWorkspaceId(['/a'], 'i')).not.toBe(computeWorkspaceId(['/b'], 'i'));
  });
  it('uses empty-<instanceId> without folders', () => {
    expect(computeWorkspaceId([], 'abc123')).toBe('empty-abc123');
  });
  it('sorts normalized folders', () => {
    expect(normalizeFolders(['/b', '/a/'])).toEqual(['/a', '/b']);
  });
});

describe('path helpers', () => {
  it('detects absolute paths', () => {
    expect(isAbsolutePathLike('/a')).toBe(true);
    expect(isAbsolutePathLike('C:\\a')).toBe(true);
    expect(isAbsolutePathLike('c:/a')).toBe(true);
    expect(isAbsolutePathLike('\\\\srv\\x')).toBe(true);
    expect(isAbsolutePathLike('a/b')).toBe(false);
    expect(isAbsolutePathLike('abc')).toBe(false);
  });
  it('matches folder containment on segment boundaries', () => {
    expect(isInside('/a/b', '/a/b/c', false)).toBe(true);
    expect(isInside('/a/b', '/a/b', false)).toBe(true);
    expect(isInside('/a/b', '/a/bc', false)).toBe(false);
    expect(isInside('/A/b', '/a/b/c', true)).toBe(true);
    expect(isInside('/A/b', '/a/b/c', false)).toBe(false);
    expect(isInside('c:/', 'c:/x', false)).toBe(true);
  });
});
