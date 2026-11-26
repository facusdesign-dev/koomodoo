window.CommerceModule = (() => {
  async function createProduct(data) {
    const sb = getSB();
    const userId = KMD?.session?.user?.id;
    if (!sb || !userId) throw new Error('Iniciá sesión para publicar.');
    const payload = {
      user_id: userId,
      title: AuthModule.sanitizeText(data.title, 120),
      description: AuthModule.sanitizeText(data.description, 4000),
      price: Number(data.price || 0),
      image_url: data.image_url || '',
      currency: data.currency || 'UYU',
      category: data.category || 'tecnologia',
      condition: data.condition || 'Nuevo',
      media_urls: data.media_urls || (data.image_url ? [data.image_url] : []),
      variants: data.variants || {},
    };
    const variants = data.inventory || [{ label: 'Unica', price: payload.price, stock: Number(data.stock || 0), attributes: {} }];
    if (!Number.isFinite(payload.price) || payload.price <= 0) throw new Error('El precio debe ser mayor que cero.');
    if (variants.some(v => !Number.isInteger(v.stock) || v.stock < 0 || !Number.isFinite(v.price) || v.price <= 0)) throw new Error('Revisá precio y stock de las variantes.');
    const { data: row, error } = await sb.rpc('publish_product', { p_product: payload, p_variants: variants });
    if (error) {
      console.error('[KMD] createProduct:', error);
      throw error;
    }
    return row;
  }

  async function getUserProducts(userId) {
    const sb = getSB();
    if (!sb || !userId) return [];
    const { data, error } = await sb
      .from('products')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[KMD] getUserProducts:', error);
      return [];
    }
    return data || [];
  }

  async function updateProduct(productId, data) {
    const sb = getSB();
    if (!sb || !productId) return null;
    const payload = {};
    if (data.title !== undefined) payload.title = AuthModule.sanitizeText(data.title, 120);
    if (data.description !== undefined) payload.description = AuthModule.sanitizeText(data.description, 1200);
    if (data.price !== undefined) throw new Error('Edita el precio desde Editar precio y stock para mantener las variantes sincronizadas.');
    if (data.image_url !== undefined) payload.image_url = data.image_url || '';
    const { data: row, error } = await sb
      .from('products')
      .update(payload)
      .eq('id', productId)
      .select('*')
      .single();
    if (error) {
      console.error('[KMD] updateProduct:', error);
      return null;
    }
    return row;
  }

  async function createSale(productId, sellerId) {
    const { variants } = await getProductDetails(productId);
    if (variants.length !== 1) throw new Error('Seleccioná una variante desde el producto.');
    return reserveOrder([{ variant_id: variants[0].id, quantity: 1 }], crypto.randomUUID());
  }

  async function completeSale(saleId, rating) {
    throw new Error('El pago aún no está integrado. Una venta solo se completará con confirmación del proveedor.');
  }

  async function getProductDetails(id) {
    const sb = getSB();
    if (!sb) throw new Error('Sin conexión con Supabase.');
    const [product, variants] = await Promise.all([
      sb.from('products').select('*').eq('id', id).single(),
      sb.from('product_variants').select('*').eq('product_id', id).order('label'),
    ]);
    if (product.error) throw product.error;
    if (variants.error) throw variants.error;
    return { product: product.data, variants: variants.data || [] };
  }
  async function reserveOrder(items, key, delivery=null) {
    if (!KMD.session?.user?.id) throw new Error('Iniciá sesión para crear el pedido.');
    const args={p_items:items,p_key:key};
    if(delivery)args.p_delivery=delivery;
    const { data, error } = await getSB().rpc(delivery?'reserve_delivery_order':'reserve_order',args);
    if (error) throw error;
    return data;
  }
  async function listOrders() {
    if (!KMD.session?.user?.id) return [];
    const { data, error } = await getSB().from('orders').select('*,order_items(*)').order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return data || [];
  }
  async function cancelOrder(id) {
    const { data, error } = await getSB().rpc('cancel_order', { p_order: id });
    if (error) throw error;
    return data;
  }

  async function saveInventory(productId, variants) {
    if (!KMD.session?.user?.id) throw new Error('Iniciá sesión para editar.');
    if (!variants.length || variants.some(v => !Number.isSafeInteger(v.stock) || v.stock < 0 ||
        !Number.isFinite(v.price) || v.price <= 0 || !Number.isSafeInteger(Number(v.revision)))) {
      throw new Error('Revisá precio y stock de las variantes.');
    }
    const { data, error } = await getSB().rpc('save_product_inventory', {
      p_product: productId,
      p_inventory: variants.map(({ id, price, stock, revision }) => ({ id, price, stock, revision })),
    });
    if (error) { console.error('[KMD] save inventory:', error); throw error; }
    return data;
  }
  async function savePublication(product, content, inventory, removed) {
    if(!KMD.session?.user?.id || product.user_id!==KMD.session.user.id)throw new Error('Solo el propietario puede editar.');
    const {data,error}=await getSB().rpc('edit_publication',{p_id:product.id,p_revision:product.revision,p_content:content,p_inventory:inventory,p_removed:removed});
    if(error){console.error('[KMD publication edit]',error);throw error;}return data;
  }

  async function reviewCart(items) {
    const details = new Map();
    const updated = [];
    let priceChanged = false;
    for (const item of items) {
      if (!details.has(item.pid)) details.set(item.pid, await getProductDetails(item.pid));
      const { product, variants } = details.get(item.pid);
      const variant = variants.find(v => v.id === item.variantId);
      if (product.status !== 'published' || !variant) throw new Error('Un producto ya no está disponible. Revisá tu carrito.');
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99 || variant.stock < item.qty) {
        throw new Error(`Stock insuficiente para ${product.title} (${variant.label}).`);
      }
      if (product.currency !== item.currency || product.user_id !== item.sellerId) throw new Error('El producto cambió. Volvé a agregarlo al carrito.');
      const price = Number(variant.price);
      if (price !== Number(item.price)) priceChanged = true;
      updated.push({ ...item, price, title: product.title, variantLabel: variant.label });
    }
    return { items: updated, priceChanged };
  }

  async function getSalesCount(userId) {
    const sb = getSB();
    if (!sb || !userId) return 0;
    const { count, error } = await sb
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('seller_id', userId)
      .eq('status', 'completed');
    if (error) {
      console.error('[KMD] getSalesCount:', error);
      return 0;
    }
    return count || 0;
  }

  async function getAverageRating(userId) {
    const sb = getSB();
    if (!sb || !userId) return '0.0';
    const { data, error } = await sb.from('ratings').select('rating').eq('to_user', userId);
    if (error) {
      console.error('[KMD] getAverageRating:', error);
      return '0.0';
    }
    const rows = data || [];
    if (!rows.length) return '0.0';
    const avg = rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / rows.length;
    return avg.toFixed(1);
  }

  window.createProduct = createProduct;
  window.getUserProducts = getUserProducts;
  window.updateProduct = updateProduct;
  window.createSale = createSale;
  window.completeSale = completeSale;
  window.getSalesCount = getSalesCount;
  window.getAverageRating = getAverageRating;

  return {
    createProduct,
    getUserProducts,
    updateProduct,
    createSale,
    completeSale,
    getSalesCount,
    getAverageRating,
    getProductDetails,
    reserveOrder,
    listOrders,
    cancelOrder,
    saveInventory,
    savePublication,
    reviewCart,
  };
})();
