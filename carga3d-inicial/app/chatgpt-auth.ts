import {
  type ChatGPTUser,
  COOKIE_SESSION_NAME,
  parseCookies,
  serializeSessionUser,
  parseSessionUser
} from "../lib/auth-session";

export type { ChatGPTUser };
export { COOKIE_SESSION_NAME, parseCookies, serializeSessionUser, parseSessionUser };

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const { headers } = await import("next/headers");
  const requestHeaders = await headers();

  // 1. Tenta autenticação por sessão local (Cookie c3d_session)
  const cookieHeader = requestHeaders.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const sessionValue = cookies[COOKIE_SESSION_NAME];

  if (sessionValue) {
    const localUser = parseSessionUser(sessionValue);
    if (localUser) return localUser;
  }

  // 2. Fallback para cabeçalhos de ambiente em proxy / OpenAI
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) {
    // 3. Fallback se houver cookie __sites_local_auth
    if (cookies["__sites_local_auth"]) {
      return {
        userId: "local_seedy",
        displayName: "Seedy (Local)",
        email: "seedy@sites.test",
        fullName: "Seedy Local",
        role: "Administrador Local"
      };
    }
    return null;
  }

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
    role: "Operador de Carga"
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  const { redirect } = await import("next/navigation");
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
