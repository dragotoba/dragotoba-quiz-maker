import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google";

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

function GoogleButton({ onCredential, onError, disabled }: GoogleSignInProps) {
  return (
    <div className={`flex justify-center${disabled ? " pointer-events-none opacity-60" : ""}`}>
      <GoogleLogin
        onSuccess={async (response) => {
          if (disabled) return;
          if (!response.credential) {
            onError("Google sign-in did not return a credential.");
            return;
          }
          try {
            await onCredential(response.credential);
          } catch (err) {
            onError(err instanceof Error ? err.message : "Google sign-in failed.");
          }
        }}
        onError={() => onError("Google sign-in failed. Please try again.")}
        useOneTap={false}
        theme="outline"
        size="large"
        shape="pill"
        text="continue_with"
        width={320}
      />
    </div>
  );
}

export default function GoogleSignIn(props: GoogleSignInProps) {
  const clientId = getGoogleClientId();
  if (!clientId) return null;

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <GoogleButton {...props} />
    </GoogleOAuthProvider>
  );
}
