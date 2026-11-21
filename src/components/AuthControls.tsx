/**
 * AuthControls.tsx provides GitHub OAuth sign-in in the site header.
 * Sign-in navigates to the local /auth/login/github route so the server can set
 * the PKCE verifier cookie before redirecting to Supabase → GitHub. After the
 * callback restores the session, SIGNED_IN triggers pullAndMergeAllUserData so
 * cognitive, suite, aim, recommendation, and settings stores converge.
 * Failed OAuth returns with no session; this component reads query + hash errors
 * so "pending email verification" is visible instead of a silent login link.
 */

"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { pullAndMergeAllUserData } from "@/lib/cloud-sync";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** AuthNotice is a short header message for failed or pending sign-in flows. */
type AuthNotice = {
  /** Stable code used for styling and copy selection. */
  code: string;
  /** User-facing Chinese explanation shown under the controls. */
  message: string;
};

/**
 * displayNameFor prefers the GitHub login, then full name, then email for the header chip.
 */
function displayNameFor(user: User): string {
  const meta = user.user_metadata ?? {};
  const login =
    (typeof meta.user_name === "string" && meta.user_name) ||
    (typeof meta.preferred_username === "string" && meta.preferred_username) ||
    (typeof meta.name === "string" && meta.name) ||
    user.email;
  return login || "已登录";
}

/**
 * noticeFromParams maps Supabase / app auth error codes to a visible header notice.
 * provider_email_needs_verification means Confirm email is on and GitHub email is unverified.
 */
function noticeFromParams(
  errorCode: string | null,
  authError: string | null,
  description: string | null,
): AuthNotice | null {
  const code = (errorCode || authError || "").toLowerCase();
  const desc = (description || "").toLowerCase();

  if (
    code.includes("provider_email_needs_verification") ||
    desc.includes("unverified email") ||
    desc.includes("confirmation email")
  ) {
    return {
      code: "provider_email_needs_verification",
      message: "GitHub 邮箱未验证：请查收确认邮件后再登录（或在 GitHub 验证主邮箱）。",
    };
  }

  if (!authError && !errorCode) {
    return null;
  }

  if (code === "missing_code") {
    // Prefer a real provider error from the hash when both are present.
    if (description) {
      return { code: "oauth_denied", message: description.replace(/\+/g, " ") };
    }
    return null;
  }

  return {
    code: errorCode || authError || "auth_error",
    message: (description || authError || "登录失败").replace(/\+/g, " "),
  };
}

/**
 * readAuthNoticeFromLocation pulls auth failures from ?auth_error= and #error= fragments.
 * Supabase often puts OAuth denials in the hash; the server never sees those bytes.
 */
function readAuthNoticeFromLocation(): AuthNotice | null {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const notice = noticeFromParams(
    hashParams.get("error_code") || url.searchParams.get("error_code"),
    url.searchParams.get("auth_error") || hashParams.get("error"),
    hashParams.get("error_description") || url.searchParams.get("error_description"),
  );

  if (notice || url.searchParams.has("auth_error") || url.hash.includes("error")) {
    url.searchParams.delete("auth_error");
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    url.hash = "";
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  return notice;
}

/**
 * AuthControls shows GitHub login, a pending/error notice, or the signed-in identity.
 * Session state is subscribed via onAuthStateChange so the header tracks login live.
 */
export function AuthControls() {
  const [user, setUser] = useState<User | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  useEffect(() => {
    setNotice(readAuthNoticeFromLocation());

    const supabase = createSupabaseBrowserClient();
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data.user);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "SIGNED_IN") {
        setNotice(null);
        void pullAndMergeAllUserData();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  /**
   * signOut clears the Supabase session cookies; local history remains on device.
   */
  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  }

  if (user) {
    const label = displayNameFor(user);
    return (
      <div className="auth-controls">
        <span className="auth-controls__email" title={user.email ?? label}>
          {label}
        </span>
        <button type="button" className="site-header__link" onClick={() => void signOut()}>
          退出
        </button>
      </div>
    );
  }

  const pendingVerify = notice?.code === "provider_email_needs_verification";

  return (
    <div className="auth-controls">
      {pendingVerify ? (
        <span className="auth-controls__email" title={notice.message}>
          待验证邮箱
        </span>
      ) : (
        <a className="site-header__link" href="/auth/login/github?next=/train">
          GitHub 登录
        </a>
      )}
      {pendingVerify ? (
        <a className="site-header__link" href="/auth/login/github?next=/train">
          重试
        </a>
      ) : null}
      {notice ? <p className="auth-controls__inline-error">{notice.message}</p> : null}
    </div>
  );
}
