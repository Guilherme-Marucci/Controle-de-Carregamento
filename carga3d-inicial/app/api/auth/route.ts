import { getChatGPTUser } from '../../chatgpt-auth';
import {
  COOKIE_SESSION_NAME,
  PRESET_USERS,
  type ChatGPTUser
} from '@/lib/auth-session';

export { PRESET_USERS };

export async function GET() {
  const user = await getChatGPTUser();
  return Response.json({
    authenticated: !!user,
    user: user,
    presets: PRESET_USERS
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: 'login' | 'logout' | 'custom_login';
      userId?: string;
      displayName?: string;
      fullName?: string;
      email?: string;
      role?: string;
    };

    if (body.action === 'logout') {
      const response = Response.json({ ok: true, message: 'Sessão encerrada com sucesso.' });
      response.headers.append(
        'Set-Cookie',
        `${COOKIE_SESSION_NAME}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`
      );
      // Também limpa o cookie __sites_local_auth para garantir logout limpo
      response.headers.append(
        'Set-Cookie',
        `__sites_local_auth=; Path=/; Max-Age=0; SameSite=Lax`
      );
      return response;
    }

    let targetUser: ChatGPTUser;

    if (body.action === 'login' && body.userId) {
      const preset = PRESET_USERS.find(u => u.userId === body.userId);
      if (!preset) {
        return Response.json({ error: 'Perfil de usuário não encontrado.' }, { status: 404 });
      }
      targetUser = {
        userId: preset.userId,
        displayName: preset.displayName,
        fullName: preset.fullName,
        email: preset.email,
        role: preset.role
      };
    } else {
      // Login customizado com validação rigorosa de segurança
      const name = (body.displayName || body.fullName || '').trim();
      const email = (body.email || '').trim().toLowerCase();
      const role = (body.role || 'Operador Logístico').trim();

      if (!name || name.length < 2 || name.length > 80) {
        return Response.json({ error: 'Informe um nome válido entre 2 e 80 caracteres.' }, { status: 400 });
      }
      if (!email || !email.includes('@') || email.length > 120) {
        return Response.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
      }

      const cleanUserId = `usr_${email.replace(/[^a-z0-9]/gi, '_').slice(0, 30)}`;
      targetUser = {
        userId: cleanUserId,
        displayName: name,
        fullName: name,
        email,
        role
      };
    }

    // Serializa o usuário em JSON codificado em base64 com prefixo seguro
    const sessionPayload = Buffer.from(JSON.stringify(targetUser)).toString('base64');
    const cookieValue = `b64_${sessionPayload}`;

    const response = Response.json({
      ok: true,
      message: `Bem-vindo(a), ${targetUser.displayName}!`,
      user: targetUser
    });

    // Cookie de sessão persistente por 30 dias (2592000 segundos)
    response.headers.append(
      'Set-Cookie',
      `${COOKIE_SESSION_NAME}=${encodeURIComponent(cookieValue)}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly`
    );

    return response;
  } catch (error) {
    console.error('auth error', error);
    return Response.json({ error: 'Erro ao processar autenticação.' }, { status: 500 });
  }
}
