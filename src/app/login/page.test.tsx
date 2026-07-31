import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './page';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

afterEach(cleanup);

describe('LoginPage', () => {
  it('frames sign in as a protected operations terminal', async () => {
    render(<LoginPage />);

    expect(await screen.findByRole('heading', { name: 'Operations terminal' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
  });
});
