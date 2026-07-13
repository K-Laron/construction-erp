import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('CSP middleware', () => {
  it('sets Content-Security-Policy header', () => {
    const request = new NextRequest(new Request('http://localhost:3000/'));
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('allows inline scripts and styles', () => {
    const request = new NextRequest(new Request('http://localhost:3000/'));
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('restricts base URI and form actions', () => {
    const request = new NextRequest(new Request('http://localhost:3000/'));
    const response = middleware(request);
    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
