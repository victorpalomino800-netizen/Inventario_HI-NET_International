import { db } from './supabase.js';

let inventory = [];
let movements = [];
let currentBase64Photo = '';

const $ = (id) => document.getElementById(id);

const dom = {
  productForm: $('product-form'), movementForm: $('movement-form'), editHistoryForm: $('edit-history-form'),
  tableBody: $('inventory-table-body'), movementsTableBody: $('movements-table-body'), alertsTableBody: $('alerts-table-body'),
  movProductSelect: $('mov-product'), movPhotoInput: $('mov-photo'), photoPreview: $('photo-preview'), photoPreviewContainer: $('photo-preview-container'),
  labelsGrid: $('labels-grid')
};

const pageData = {
  'dashboard-section': ['Dashboard', 'Resumen general del inventario'],
  'stock-section': ['Productos', 'Gestión de productos, QR y código de barras'],
  'movement-section': ['Registrar Movimiento', 'Entradas y salidas con evidencia fotográfica'],
  'history-section': ['Historial', 'Consulta, filtros y exportación'],
  'labels-section': ['Etiquetas QR/Barra', 'Genera e imprime etiquetas para escanear desde la app'],
  'alerts-section': ['Alertas', 'Productos con stock bajo o agotado']
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function goToSection(sectionId) {
  document.querySelectorAll('.menu-item').forEach(btn => btn.classList.toggle('active', btn.dataset.section === sectionId));
  document.querySelectorAll('.content-section').forEach(sec => sec.classList.toggle('active', sec.id === sectionId));
  const [title, subtitle] = pageData[sectionId] || pageData['dashboard-section'];
  $('page-title').textContent = title; $('page-subtitle').textContent = subtitle;
}

document.querySelectorAll('.menu-item').forEach(btn => btn.addEventListener('click', () => goToSection(btn.dataset.section)));
$('btn-refresh').addEventListener('click', loadData);
$('btn-theme').addEventListener('click', () => document.body.classList.toggle('dark'));

export async function loadData() {
  const { data: invData, error: invError } = await db.from('inventario').select('*').order('name', { ascending: true });
  if (invError) return alert('Error cargando inventario: ' + invError.message);
  inventory = invData || [];

  const { data: movData, error: movError } = await db.from('movimientos').select('*');
  if (movError) return alert('Error cargando movimientos: ' + movError.message);
  movements = movData || [];

  renderAll();
}

function renderAll(){ renderStats(); renderInventory(); renderMovements(); renderAlerts(); updateProductSelects(); renderLabels(); }

function renderStats(){
  const total = inventory.length;
  const empty = inventory.filter(i => Number(i.qty) <= 0).length;
  const low = inventory.filter(i => Number(i.qty) > 0 && Number(i.qty) <= Number(i.min)).length;
  const stock = inventory.filter(i => Number(i.qty) > Number(i.min)).length;
  $('stat-total').textContent = total; $('stat-stock').textContent = stock; $('stat-low').textContent = low; $('stat-empty').textContent = empty;
}

function updateProductSelects(){
  const selectedMov = dom.movProductSelect?.value || '';
  const options = inventory.map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)} - ${escapeHtml(i.id)} (Stock: ${i.qty})</option>`).join('');
  dom.movProductSelect.innerHTML = options || '<option value="">No hay productos</option>';
  if (selectedMov && inventory.some(i => i.id === selectedMov)) dom.movProductSelect.value = selectedMov;
}

function statusFor(item){
  if (Number(item.qty) <= 0) return ['badge-empty','❌ Sin Stock'];
  if (Number(item.qty) <= Number(item.min)) return ['badge-reorder','🚨 Reabastecer'];
  return ['badge-ok','🟢 Stock OK'];
}

function renderInventory(data = inventory){
  dom.tableBody.innerHTML = '';
  if (!data.length) { dom.tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b">No hay productos.</td></tr>'; return; }
  data.forEach(item => {
    const idx = inventory.findIndex(i => i.id === item.id);
    const [badgeClass, status] = statusFor(item);
    const row = document.createElement('tr');
    row.innerHTML = `<td class="barcode-container"><svg id="barcode-${escapeHtml(item.id)}"></svg></td><td><strong>${escapeHtml(item.name)}</strong><br><small style="color:#64748b">Código: ${escapeHtml(item.id)}</small></td><td><strong>${item.qty}</strong> uds</td><td>${item.min}</td><td><span class="badge ${badgeClass}">${status}</span></td><td><small>${escapeHtml(item.obs || '-')}</small></td><td><div class="action-btns"><button class="btn-sm btn-edit-active" data-edit-product="${idx}">✏️ Editar</button><button class="btn-sm btn-plus" data-quick="${escapeHtml(item.id)}|1">+1</button><button class="btn-sm btn-minus" data-quick="${escapeHtml(item.id)}|-1">-1</button><button class="btn-sm btn-edit-active" data-label="${escapeHtml(item.id)}">🏷️ Etiqueta</button><button class="btn-sm btn-delete" data-delete="${escapeHtml(item.id)}">🗑️</button></div></td>`;
    dom.tableBody.appendChild(row);
    try { JsBarcode(`#barcode-${CSS.escape(item.id)}`, item.id, { format:'CODE39', width:1.2, height:34, displayValue:true, fontSize:10, margin:0 }); } catch(e){ console.warn(e); }
  });
}

dom.tableBody.addEventListener('click', e => {
  const edit = e.target.dataset.editProduct, quick = e.target.dataset.quick, del = e.target.dataset.delete, label = e.target.dataset.label;
  if (edit !== undefined) startProductEdit(Number(edit));
  if (quick) { const [id, amount] = quick.split('|'); quickQtyUpdate(id, Number(amount)); }
  if (label) { goToSection('labels-section'); setTimeout(() => document.getElementById(`label-card-${safeDomId(label)}`)?.scrollIntoView({ behavior:'smooth', block:'center' }), 100); }
  if (del) deleteItem(del);
});

function renderMovements(data = movements){
  dom.movementsTableBody.innerHTML = '';
  if (!data.length) { dom.movementsTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b">No hay movimientos.</td></tr>'; return; }
  [...data].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).forEach(mov=>{
    const typeClass = mov.type === 'ENTRADA' ? 'mov-in' : 'mov-out';
    const photo = mov.photo ? `<img src="${mov.photo}" class="thumb-img" alt="Foto">` : '<span style="color:#94a3b8;font-size:11px">Sin foto</span>';
    const row = document.createElement('tr');
    row.innerHTML = `<td><small>${new Date(mov.created_at).toLocaleString()}</small></td><td><span class="badge ${typeClass}">${mov.type}</span></td><td><strong>${escapeHtml(mov.product_name)}</strong></td><td>${mov.qty} uds</td><td>👤 ${escapeHtml(mov.technician)}</td><td><em>${escapeHtml(mov.obs || '-')}</em></td><td>${photo}</td><td><button class="btn-sm btn-edit-active" data-edit-mov="${mov.id}">✏️ Modificar</button></td>`;
    dom.movementsTableBody.appendChild(row);
  });
}

dom.movementsTableBody.addEventListener('click', e => { if (e.target.dataset.editMov) startHistoryEdit(Number(e.target.dataset.editMov)); });

function renderAlerts(){
  const alerts = inventory.filter(i => Number(i.qty) <= Number(i.min));
  dom.alertsTableBody.innerHTML = '';
  if (!alerts.length) { dom.alertsTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#10b981;font-weight:800">✅ Todo bien. No hay alertas.</td></tr>'; return; }
  alerts.forEach(item => { const [badgeClass, status] = statusFor(item); dom.alertsTableBody.innerHTML += `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.id)}</small></td><td><strong>${item.qty}</strong></td><td>${item.min}</td><td><span class="badge ${badgeClass}">${status}</span></td></tr>`; });
}

$('search-inventory').addEventListener('input', () => {
  const s = $('search-inventory').value.toLowerCase().trim();
  renderInventory(inventory.filter(i => i.name.toLowerCase().includes(s) || i.id.toLowerCase().includes(s) || (i.obs || '').toLowerCase().includes(s)));
});
$('btn-clear-inventory').addEventListener('click', () => { $('search-inventory').value = ''; renderInventory(); });

if (dom.movPhotoInput) dom.movPhotoInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) { currentBase64Photo = ''; dom.photoPreviewContainer.classList.add('hidden'); return; }
  const reader = new FileReader();
  reader.onload = ev => { currentBase64Photo = ev.target.result; dom.photoPreview.src = currentBase64Photo; dom.photoPreviewContainer.classList.remove('hidden'); };
  reader.readAsDataURL(file);
});

dom.productForm.addEventListener('submit', async e => {
  e.preventDefault();
  const indexVal = $('edit-index').value;
  const id = $('prod-id').value.trim().toUpperCase().replace(/\s+/g,'-');
  const name = $('prod-name').value.trim();
  const qty = parseInt($('prod-qty').value); const min = parseInt($('prod-min').value); const obs = $('prod-obs').value.trim();
  if (!id || !name || Number.isNaN(qty) || Number.isNaN(min)) return alert('Completa los datos.');
  if (indexVal === '') {
    if (inventory.some(i => i.id === id)) return alert('El código ya existe.');
    const { error } = await db.from('inventario').insert([{ id, name, qty, min, obs }]);
    if (error) return alert('Error al guardar: ' + error.message);
  } else {
    const { error } = await db.from('inventario').update({ name, qty, min, obs }).eq('id', id);
    if (error) return alert('Error al actualizar: ' + error.message);
    cancelProductEdit();
  }
  dom.productForm.reset();
});

function startProductEdit(index){
  const item = inventory[index]; if (!item) return;
  $('edit-index').value = index; $('prod-id').value = item.id; $('prod-id').disabled = true; $('prod-name').value = item.name; $('prod-qty').value = item.qty; $('prod-min').value = item.min; $('prod-obs').value = item.obs || '';
  $('form-product-title').textContent = `✏️ Editando Producto: ${item.name}`; $('btn-submit-product').textContent = 'Actualizar'; $('btn-cancel-edit').classList.remove('hidden'); window.scrollTo({top:0,behavior:'smooth'});
}
function cancelProductEdit(){ dom.productForm.reset(); $('edit-index').value=''; $('prod-id').disabled=false; $('form-product-title').textContent='➕ Registrar Producto'; $('btn-submit-product').textContent='Guardar'; $('btn-cancel-edit').classList.add('hidden'); }
$('btn-cancel-edit').addEventListener('click', cancelProductEdit);

async function deleteItem(id){
  const item = inventory.find(i => i.id === id);
  if (!confirm(`¿Eliminar "${item?.name || id}"?`)) return;

  const { error } = await db.from('inventario').delete().eq('id', id);

  if (error) {
    alert('No se pudo eliminar. Revisa permisos RLS o relaciones en Supabase: ' + error.message);
    return;
  }

  alert('🗑️ Producto eliminado correctamente.');
  await loadData();
}

async function quickQtyUpdate(id, amount){
  const item = inventory.find(i => i.id === id); if (!item) return;
  const type = amount > 0 ? 'ENTRADA' : 'SALIDA'; const abs = Math.abs(amount);
  if (type === 'SALIDA' && Number(item.qty) < abs) return alert('Stock insuficiente.');
  const newQty = Math.max(0, Number(item.qty) + amount);
  const { error } = await db.from('inventario').update({ qty: newQty }).eq('id', id); if (error) return alert(error.message);
  await db.from('movimientos').insert([{ type, product_name:item.name, qty:abs, technician:'Oficina / Stock', obs:'Ajuste rápido desde panel web', photo:'' }]);
}

dom.movementForm.addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('mov-type').value; const productId = $('mov-product').value; const qty = parseInt($('mov-qty').value); const technician = $('mov-technician').value; const obs = $('mov-obs').value.trim();
  const product = inventory.find(i => i.id === productId); if (!product) return alert('Selecciona un producto.');
  if (type === 'SALIDA' && Number(product.qty) < qty) return alert(`Stock insuficiente. Disponible: ${product.qty}`);
  const newQty = type === 'ENTRADA' ? Number(product.qty) + qty : Number(product.qty) - qty;
  const { error: invError } = await db.from('inventario').update({ qty:newQty }).eq('id', productId); if (invError) return alert(invError.message);
  const { error: movError } = await db.from('movimientos').insert([{ type, product_name:product.name, qty, technician, obs: obs || 'Sin observaciones', photo: currentBase64Photo }]); if (movError) return alert(movError.message);
  currentBase64Photo=''; dom.photoPreview.src=''; dom.photoPreviewContainer.classList.add('hidden'); dom.movementForm.reset(); $('mov-qty').value=1; goToSection('history-section');
});

function filterMovements(){
  const s = $('filter-search').value.toLowerCase().trim(); const type = $('filter-type').value; const date = $('filter-date').value;
  renderMovements(movements.filter(m => (m.product_name.toLowerCase().includes(s) || m.technician.toLowerCase().includes(s) || (m.obs||'').toLowerCase().includes(s)) && (type==='TODOS'||m.type===type) && (!date || new Date(m.created_at).toISOString().split('T')[0]===date)));
}
['filter-search','filter-type','filter-date'].forEach(id => $(id).addEventListener('input', filterMovements));
$('filter-type').addEventListener('change', filterMovements); $('filter-date').addEventListener('change', filterMovements);

function startHistoryEdit(movId){
  const mov = movements.find(m => Number(m.id) === Number(movId)); if (!mov) return;
  $('edit-history-index').value=movId; $('edit-history-type').value=mov.type; $('edit-history-qty').value=mov.qty; $('edit-history-tech').value=mov.technician; $('edit-history-obs').value=mov.obs || '';
  $('edit-history-section').classList.remove('hidden'); $('edit-history-section').scrollIntoView({behavior:'smooth'});
}
$('btn-close-history-edit').addEventListener('click', () => $('edit-history-section').classList.add('hidden'));

dom.editHistoryForm.addEventListener('submit', async e => {
  e.preventDefault();
  const movId = parseInt($('edit-history-index').value); const oldMov = movements.find(m => Number(m.id) === Number(movId)); if (!oldMov) return;
  const newType = $('edit-history-type').value; const newQty = parseInt($('edit-history-qty').value); const newTech = $('edit-history-tech').value; const newObs = $('edit-history-obs').value.trim();
  const prod = inventory.find(i => i.name === oldMov.product_name);
  if (prod) {
    let temp = Number(prod.qty); oldMov.type === 'ENTRADA' ? temp -= Number(oldMov.qty) : temp += Number(oldMov.qty);
    if (newType === 'SALIDA' && temp < newQty) return alert(`El cambio dejaría stock negativo. Disponible real: ${temp}`);
    newType === 'ENTRADA' ? temp += newQty : temp -= newQty;
    const { error } = await db.from('inventario').update({ qty:Math.max(0,temp) }).eq('id', prod.id); if (error) return alert(error.message);
  }
  const { error } = await db.from('movimientos').update({ type:newType, qty:newQty, technician:newTech, obs:newObs }).eq('id', movId); if (error) return alert(error.message);
  $('edit-history-section').classList.add('hidden');
});

$('btn-excel').addEventListener('click', () => {
  if (!movements.length) return alert('No hay registros.');
  const data = movements.map(m => ({ 'Fecha y Hora':new Date(m.created_at).toLocaleString(), Tipo:m.type, Producto:m.product_name, Cantidad:m.qty, Técnico:m.technician, Observación:m.obs, 'Foto Evidencia':m.photo?'SÍ':'NO' }));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Historial'); XLSX.writeFile(wb, `Reporte_HN_${new Date().toISOString().slice(0,10)}.xlsx`);
});


function renderLabels(){
  if (!dom.labelsGrid) return;
  dom.labelsGrid.innerHTML = '';

  if (!inventory.length) {
    dom.labelsGrid.innerHTML = '<p style="color:#64748b;font-weight:800">No hay productos registrados para generar etiquetas.</p>';
    return;
  }

  inventory.forEach(item => {
    const card = document.createElement('div');
    card.className = 'label-card-wrapper';
    card.id = `label-card-${safeDomId(item.id)}`;
    card.innerHTML = `
      <div class="label-box">
        <h3>HN Smart Inventory</h3>
        <div class="qr-zone">
          <div id="qr-${safeDomId(item.id)}" class="qr-box"></div>
          <small>Escanear QR</small>
        </div>
        <div class="barcode-zone">
          <svg id="barcode-label-${safeDomId(item.id)}"></svg>
          <small>Escanear código de barras</small>
        </div>
        <p>${escapeHtml(item.id)} | ${escapeHtml(item.name)}</p>
        <small class="label-note">QR y barra conectados al código: ${escapeHtml(item.id)}</small>
      </div>
      <button class="btn edit label-edit-btn" data-edit-label="${escapeHtml(item.id)}">✏️ Editar producto</button>
    `;
    dom.labelsGrid.appendChild(card);

    generateBarcodeForLabel(item.id);
    generateQrForLabel(item.id);
  });
}

function generateBarcodeForLabel(code){
  try {
    JsBarcode(`#barcode-label-${CSS.escape(safeDomId(code))}`, code, {
      format:'CODE39',
      width:1.35,
      height:55,
      displayValue:true,
      fontSize:12,
      margin:0
    });
  } catch(e){
    console.warn('No se pudo generar el código de barras:', code, e);
  }
}

function generateQrForLabel(code){
  const qrElement = $(`qr-${safeDomId(code)}`);
  if (!qrElement) return;
  qrElement.innerHTML = '';

  try {
    if (window.QRCode && typeof window.QRCode === 'function') {
      new window.QRCode(qrElement, {
        text: code,
        width: 138,
        height: 138,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel?.M || 0
      });
      return;
    }
  } catch(e){
    console.warn('Falló QRCode local:', code, e);
  }

  // Respaldo: genera el QR como imagen externa si la librería local no cargó.
  const img = document.createElement('img');
  img.alt = `QR ${code}`;
  img.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(code)}`;
  qrElement.appendChild(img);
}

function editLabelProduct(id){
  const index = inventory.findIndex(i => i.id === id);
  if (index < 0) return alert('Producto no encontrado.');
  goToSection('stock-section');
  startProductEdit(index);
}

if (dom.labelsGrid) {
  dom.labelsGrid.addEventListener('click', e => {
    const id = e.target.dataset.editLabel;
    if (id) editLabelProduct(id);
  });
}

$('btn-print-label').addEventListener('click', () => window.print());

function safeDomId(value){
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

db.channel('hn-smart-inventory').on('postgres_changes', { event:'*', schema:'public', table:'inventario' }, loadData).on('postgres_changes', { event:'*', schema:'public', table:'movimientos' }, loadData).subscribe();

loadData();
