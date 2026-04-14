import { signIn } from "@/auth";
import Link from "next/link";

export const metadata = {
  title: "Sign In",
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="text-xl font-bold text-navy-900">
            Moatboard
          </Link>
        </div>
      </nav>

      <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full rounded-xl border border-navy-200 bg-white p-8 shadow-sm">
          <h1 className="text-center text-2xl font-bold text-navy-950">
            Welcome to Moatboard
          </h1>
          <p className="mt-2 text-center text-sm text-navy-600">
            Sign in to start tracking your businesses.
          </p>

          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: callbackUrl ?? "/dashboard" });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-navy-300 bg-white px-4 py-3 text-sm font-medium text-navy-900 hover:bg-navy-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-navy-500">
            By signing in you agree to get access to your portfolio dashboard.
          </p>
        </div>
      </main>
    </div>
  );
}
