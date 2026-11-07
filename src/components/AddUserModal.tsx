import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../domain/permissions';
import { Modal } from './ui';
import type { Role } from '../types';

const ROLES: Role[] = ['owner', 'manager', 'purchasing', 'receiving', 'stock', 'cashier', 'auditor'];

const emptyForm = { name: '', role: 'cashier' as Role, phone: '' };

export function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions } = useApp();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  const submit = () => {
    if (actions.addUser(form)) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a user manually"
      subtitle="Creates the account immediately. The role sets the access boundary and is not a menu preference."
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={!form.name.trim() || !form.phone.trim()}>
            <UserPlus size={16} /> Create user
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="new-user-name">Full name <span className="req">*</span></label>
          <input
            id="new-user-name"
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Ada Nwosu"
          />
        </div>
        <div className="field">
          <label htmlFor="new-user-role">Role <span className="req">*</span></label>
          <select
            id="new-user-role"
            className="select"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>{ROLE_LABELS[role]}</option>
            ))}
          </select>
          <span className="field__hint">{ROLE_DESCRIPTIONS[form.role]}</span>
        </div>
        <div className="field">
          <label htmlFor="new-user-phone">Phone <span className="req">*</span></label>
          <input
            id="new-user-phone"
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="+234 800 000 0000"
          />
          <span className="field__hint">Used to identify the person on documents and audit events.</span>
        </div>
      </div>
    </Modal>
  );
}
