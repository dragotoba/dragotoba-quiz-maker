import { useEffect, useRef } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, string | number>,
          ) => void;
        };
      };
    };
  }
}

export function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

type GoogleSignInProps = {
  onCredential: (idToken: string) => void | Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
};

function GoogleMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

function BrandedChrome({ disabled }: { disabled?: boolean }) {
  return (
    <div
      className={`flex w-full items-center justify-center gap-3 rounded-full border border-[#1c2a33]/18 bg-white px-6 py-3 text-sm font-semibold text-[#1c2a33] shadow-[0_2px_8px_rgba(0,0,0,0.04)] ${disabled ? "opacity-60" : ""}`}
      aria-hidden="true"
    >
      <GoogleMark />
      <span>Continue with Google</span>
    </div>
  );
}

function ConfiguredGoogleButton({ onCredential, onError, disabled }: GoogleSignInProps) {
  const clientId = getGoogleClientId();
  const hostRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef({ onCredential, onError, disabled });
  handlersRef.current = { onCredential, onError, disabled };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !clientId) return;

    let cancelled = false;
    let timer: number | undefined;

    const render = () => {
      if (cancelled || !hostRef.current || !window.google?.accounts?.id) return false;
      const width = Math.max(240, Math.floor(hostRef.current.parentElement?.clientWidth ?? 320));
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const { onCredential: next, onError: fail, disabled: isDisabled } =
            handlersRef.current;
          if (isDisabled) return;
          if (!response.credential) {
            fail("Google sign-in did not return a credential.");
            return;
          }
          void Promise.resolve(next(response.credential)).catch((err) => {
            fail(err instanceof Error ? err.message : "Google sign-in failed.");
          });
        },
      });
      hostRef.current.innerHTML = "";
      window.google.accounts.id.renderButton(hostRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width,
      });
      return true;
    };

    if (!render()) {
      timer = window.setInterval(() => {
        if (render() && timer) window.clearInterval(timer);
      }, 50);
    }

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [clientId]);

  return (
    <div className={`relative w-full${disabled ? " pointer-events-none" : ""}`}>
      <BrandedChrome disabled={disabled} />
      {/* Transparent GIS button layered on top for the real click + credential. */}
      <div
        ref={hostRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.02]"
      />
    </div>
  );
}

function UnconfiguredGoogleButton({
  onError,
  disabled,
}: {
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onError(
          "Google sign-in is not configured. Set VITE_GOOGLE_CLIENT_ID for this site build.",
        )
      }
      className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-full border border-[#1c2a33]/18 bg-white px-6 py-3 text-sm font-semibold text-[#1c2a33] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:border-[#1c2a33]/30 hover:bg-[#fafbfc] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleMark />
      <span>Continue with Google</span>
    </button>
  );
}

export default function GoogleSignIn(props: GoogleSignInProps) {
  const clientId = getGoogleClientId();

  if (!clientId) {
    return <UnconfiguredGoogleButton onError={props.onError} disabled={props.disabled} />;
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <ConfiguredGoogleButton {...props} />
    </GoogleOAuthProvider>
  );
}
