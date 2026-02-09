import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as { message?: string };
    return candidate.message ?? fallback;
  }
  return fallback;
}

export function Login() {
  const [handle, setHandle] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  if (isAuthenticated) {
    navigate('/vote');
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(handle, appPassword);
      navigate('/vote');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Login failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <svg width="40" height="40" viewBox="0 0 600 530" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" fill="currentColor"/>
          </svg>
        </div>
        <h1>Sign in to vote</h1>
        <p className="login-description">
          Connect your Bluesky account to participate in feed governance.
          You'll need an app password from your Bluesky settings.
        </p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="handle">Bluesky handle</label>
            <input
              type="text"
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="yourname.bsky.social"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="appPassword">App password</label>
            <input
              type="password"
              id="appPassword"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              required
              disabled={isSubmitting}
            />
            <small className="form-help">
              Create an app password in{' '}
              <a
                href="https://bsky.app/settings/app-passwords"
                target="_blank"
                rel="noopener noreferrer"
              >
                Bluesky Settings
              </a>
            </small>
          </div>

          <button type="submit" className="login-button" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="login-info">
          <h3>Why app password?</h3>
          <p>
            App passwords are separate from your main password and can be revoked
            at any time. They provide secure access without exposing your main
            credentials.
          </p>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-app);
  }

  .login-container {
    background: var(--bg-card);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    padding: var(--space-8);
    max-width: 400px;
    width: 100%;
  }

  .login-logo {
    display: flex;
    justify-content: center;
    margin-bottom: var(--space-6);
    color: var(--accent-blue);
  }

  .login-container h1 {
    margin: 0 0 var(--space-3) 0;
    color: var(--text-primary);
    font-size: var(--text-2xl);
    font-weight: var(--font-weight-semibold);
    text-align: center;
  }

  .login-description {
    color: var(--text-secondary);
    margin-bottom: var(--space-6);
    line-height: var(--leading-relaxed);
    text-align: center;
    font-size: var(--text-sm);
  }

  .error-message {
    background: rgba(255, 69, 58, 0.1);
    border: 1px solid rgba(255, 69, 58, 0.2);
    color: var(--status-error);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-group label {
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .form-group input {
    padding: var(--space-4);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    background: var(--bg-elevated);
    color: var(--text-primary);
    transition: border-color var(--transition-fast);
  }

  .form-group input::placeholder {
    color: var(--text-muted);
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--accent-blue);
  }

  .form-group input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-help {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .form-help a {
    color: var(--accent-blue);
  }

  .form-help a:hover {
    color: var(--accent-blue-hover);
  }

  .login-button {
    background: var(--accent-blue);
    color: white;
    border: none;
    padding: var(--space-4);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: var(--font-weight-semibold);
    cursor: pointer;
    margin-top: var(--space-2);
    transition: background var(--transition-fast);
  }

  .login-button:hover:not(:disabled) {
    background: var(--accent-blue-hover);
  }

  .login-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .login-info {
    margin-top: var(--space-8);
    padding-top: var(--space-6);
    border-top: 1px solid var(--border-default);
  }

  .login-info h3 {
    margin: 0 0 var(--space-2) 0;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: var(--font-weight-medium);
  }

  .login-info p {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    line-height: var(--leading-relaxed);
    margin: 0;
  }
`;

export default Login;
