// ==============================================================
// The form a generated system's record is added and edited in
//
// One control per field: a choice for a select, the target's records for a
// link, a read-only box for a worked-out number, and an input for the rest.
//
// A choice field used to offer only its options, so a record whose value was
// not among them — an order "Waiting" on a board of New, Cooking and Served —
// opened with the first option shown, and saving it quietly changed the
// record. The value it has is now always one of the choices.
//
// Every value is written into the markup escaped. Each label names its
// control, so a screen reader says what a box is for.
//
// Pure: a record and an entity in, markup out; the names a link can take are
// passed in. Loaded before the Systems mode and published as
// window.HCSystemsForms. Checked by scripts/checks/systems-forms.mjs.
// ==============================================================

(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

  /** The choices for a field, with the record's own value among them. */
  function withValue(list, value) {
    const out = (list || []).map(String);
    if (value !== '' && value != null && !out.some((o) => same(o, value))) out.unshift(String(value));
    return out;
  }

  /**
   * The form's controls for a record. `linkNames(field)` gives the names a
   * link field can point at.
   */
  function formHtml(record, entity, options = {}) {
    const linkNames = options.linkNames || (() => []);
    return ((entity && entity.fields) || []).map((f) => {
      const value = (record || {})[f.id] ?? '';
      const id = `sys-f-${esc(f.id)}`;
      const req = f.required ? ' required' : '';
      const label = `<label class="sys-form-label" for="${id}">${esc(f.label)}${f.required ? '<span class="sys-required">*</span>' : ''}</label>`;
      const choice = (opts, blank) => `<div class="sys-form-group">${label}
          <select class="sys-form-input" id="${id}" data-sys-field="${esc(f.id)}"${req}>
            ${blank ? '<option value="">—</option>' : ''}${opts.map((o) => `<option value="${esc(o)}"${same(value, o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}
          </select>
        </div>`;
      if (f.type === 'select') return choice(withValue(f.options, value), false);
      if (f.type === 'link') return choice(withValue(linkNames(f), value), true);
      if (f.formula) {
        return `<div class="sys-form-group">${label}
          <input class="sys-form-input" id="${id}" type="text" value="${esc(value)}" readonly title="Worked out: ${esc(f.formula)}" />
          <span class="sys-form-hint">Worked out: ${esc(f.formula)}</span>
        </div>`;
      }
      if (f.type === 'textarea') {
        return `<div class="sys-form-group sys-form-group--full">${label}
          <textarea class="sys-form-input" id="${id}" data-sys-field="${esc(f.id)}" rows="3"${req}>${esc(value)}</textarea>
        </div>`;
      }
      const type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
      return `<div class="sys-form-group">${label}
        <input class="sys-form-input" id="${id}" data-sys-field="${esc(f.id)}" type="${type}" value="${esc(value)}"${type === 'number' ? ' step="any"' : ''}${req} />
      </div>`;
    }).join('');
  }

  window.HCSystemsForms = { formHtml, withValue };
})();
