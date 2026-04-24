window.SearchModule = (() => {
  let timer = null;

  function close() {
    const dd = document.getElementById('global-search-dd');
    if (dd) {
      dd.innerHTML = '';
      dd.classList.remove('open');
    }
  }

  function render(results) {
    const dd = document.getElementById('global-search-dd');
    if (!dd) return;
    const users = Array.isArray(results?.users) ? results.users : [];
    const products = Array.isArray(results?.products) ? results.products : [];
    if (!users.length && !products.length) {
      dd.innerHTML = '<div class="gs-empty">Sin resultados</div>';
      dd.classList.add('open');
      return;
    }
    const userHtml = users.map(user => {
      const username = user.username || user.email || 'usuario';
      return `<button class="gs-item" onclick="openSearchResult('profile','${user.id}')"><div class="gs-emoji">👤</div><div class="gs-body"><div class="gs-title">@${username}</div><div class="gs-sub">${user.email || 'Perfil'}</div></div></button>`;
    }).join('');
    const productHtml = products.map(product => {
      const priceLabel = typeof fmt === 'function' ? fmt(Number(product.price || 0)) : `$${product.price || 0}`;
      const media = product.image_url
        ? `<img src="${product.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`
        : '🛍️';
      return `<button class="gs-item" onclick="openSearchResult('product','${product.id}')"><div class="gs-emoji">${media}</div><div class="gs-body"><div class="gs-title">${product.title || 'Producto'}</div><div class="gs-sub">${priceLabel}</div></div></button>`;
    }).join('');
    dd.innerHTML = `${users.length ? `<div class="gs-group">${userHtml}</div>` : ''}${products.length ? `<div class="gs-group">${productHtml}</div>` : ''}`;
    dd.classList.add('open');
  }

  async function searchGlobal(query) {
    const q = AuthModule.sanitizeText(query, 60);
    if (q.length < 2) {
      close();
      return { users: [], products: [] };
    }
    const sb = getSB();
    if (!sb) return { users: [], products: [] };
    console.log('🔎 Buscando:', q);
    const [profilesRes, productsRes] = await Promise.all([
      sb
        .from('profiles')
        .select('id, username, email')
        .ilike('username', `%${q}%`)
        .limit(5),
      sb
        .from('products')
        .select('id, title, price, image_url')
        .ilike('title', `%${q}%`)
        .limit(5),
    ]);
    if (profilesRes.error) {
      console.error(profilesRes.error);
    }
    if (productsRes.error) {
      console.error(productsRes.error);
    }
    const users = profilesRes.data || [];
    const products = productsRes.data || [];
    console.log('👤 Usuarios:', users);
    console.log('🛒 Productos:', products);
    const results = { users, products };
    render(results);
    return results;
  }

  function queue(term) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      searchGlobal(term).catch(err => {
        console.error('[KMD] search:', err);
        close();
      });
    }, 300);
  }

  return { queue, searchGlobal, close };
})();
