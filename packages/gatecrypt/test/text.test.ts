import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT, checkText, fill, mergeText } from '../src/text.js';

describe('sign-in page text', () => {
  it('replaces known sentences and ignores everything else', () => {
    const text = mergeText({ google: 'Weiter mit Google', nonsense: 'x', or: 7, retry: '', __proto__: { title: 'x' } });
    expect(text.google).toBe('Weiter mit Google');
    expect(text.or).toBe(DEFAULT_TEXT.or);
    expect(text.retry).toBe(DEFAULT_TEXT.retry);
    expect(text.title).toBe(DEFAULT_TEXT.title);
    expect(Object.keys(text)).toEqual(Object.keys(DEFAULT_TEXT));
    expect(mergeText(null)).toEqual(DEFAULT_TEXT);
    expect(mergeText('text')).toEqual(DEFAULT_TEXT);
  });

  it('checks build-time input strictly', () => {
    expect(checkText(undefined)).toEqual({});
    expect(checkText({ or: 'oder' })).toEqual({ or: 'oder' });
    expect(() => checkText({ oder: 'or' })).toThrow('text.oder is not a sentence');
    expect(() => checkText({ or: '' })).toThrow('text.or must be non-empty text');
    expect(() => checkText({ or: 1 })).toThrow('text.or must be non-empty text');
    expect(() => checkText(['or'])).toThrow('must be an object');
  });

  it('fills in names, and leaves unknown placeholders as they are', () => {
    expect(fill(DEFAULT_TEXT.signInTo, { name: 'Handbook' })).toBe('Sign in to access Handbook');
    expect(fill('{email} / {other}', { email: 'a@b.c' })).toBe('a@b.c / {other}');
  });

  it('has a sentence for everything, each with the placeholders it is given', () => {
    for (const [key, value] of Object.entries(DEFAULT_TEXT)) expect(value, key).toBeTruthy();
    expect(DEFAULT_TEXT.signInTo).toContain('{name}');
    expect(DEFAULT_TEXT.codeSent).toContain('{email}');
  });
});
