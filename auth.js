window.AuthModule = (() => {
  const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

  function sanitizeText(value, max = 240) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, max);
  }

  function sanitizeUsername(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 30);
  }

  function normalizePhone(value) {
    return String(value || '')
      .replace(/[^\d+\-\s()]/g, '')
      .trim()
      .slice(0, 30);
  }

  function isProfileComplete(profile) {
    return !!(profile && sanitizeText(profile.firstName || profile.first_name, 80) && sanitizeUsername(profile.username));
  }

  async function validateUsername(username, currentUserId = null) {
    const value = sanitizeUsername(username);
    if (value.length < 3) {
      return { ok: false, value, message: 'El usuario debe tener al menos 3 caracteres.' };
    }
    if (!USERNAME_RE.test(value)) {
      return { ok: false, value, message: 'Usá solo letras minúsculas, números o guión bajo.' };
    }
    if (typeof getSB !== 'function') {
      return { ok: true, value, message: '' };
    }
    const sb = getSB();
    if (!sb) {
      return { ok: true, value, message: '' };
    }
    let query = sb.from('profiles').select('id', { count: 'exact', head: true }).eq('username', value);
    if (currentUserId) query = query.neq('id', currentUserId);
    const { count, error } = await query;
    if (error) {
      console.error('[KMD] validateUsername:', error);
      return { ok: false, value, message: 'No se pudo validar el usuario. Intentá de nuevo.' };
    }
    if ((count || 0) > 0) {
      return { ok: false, value, message: 'Ese nombre de usuario ya está en uso.' };
    }
    return { ok: true, value, message: '' };
  }

  async function withButton(buttonId, label, task) {
    const btn = document.getElementById(buttonId);
    if (typeof afBtnLoad === 'function') afBtnLoad(buttonId, true, '');
    if (btn) btn.disabled = true;
    try {
      return await task();
    } finally {
      if (typeof afBtnLoad === 'function') afBtnLoad(buttonId, false, label);
      if (btn) btn.disabled = false;
    }
  }

  return {
    sanitizeText,
    sanitizeUsername,
    normalizePhone,
    validateUsername,
    isProfileComplete,
    withButton,
  };
})();
