import { describe, expect, it } from 'vitest';
import { classifyChannel } from '../src/lib/channels';

describe('classifyChannel', () => {
  it('classifies common acquisition channels with paid precedence', () => {
    expect(classifyChannel('www.google.com')).toBe('Organic Search');
    expect(classifyChannel('www.google.com', 'google', 'cpc')).toBe('Paid Search');
    expect(classifyChannel('facebook.com')).toBe('Organic Social');
    expect(classifyChannel('facebook.com', 'facebook', 'paid_social')).toBe('Paid Social');
    expect(classifyChannel('', 'mailchimp', 'email')).toBe('Email');
    expect(classifyChannel('chat.openai.com')).toBe('AI Assistants');
    expect(classifyChannel('claude.ai')).toBe('AI Assistants');
    expect(classifyChannel('example.org')).toBe('Referral');
    expect(classifyChannel('', '', '')).toBe('Direct');
  });

  it('returns Direct on unexpected input errors', () => {
    const bad = { toString: () => { throw new Error('boom'); } } as unknown as string;
    expect(classifyChannel(bad, '', '')).toBe('Direct');
  });
});
