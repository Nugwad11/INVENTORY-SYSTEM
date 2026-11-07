import { useEffect, useState } from 'react';
import { Save, UserPlus } from 'lucide-react';
import { useApp } from '../store/AppStore';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '../domain/permissions';
import { Modal } from './ui';
import type { Role, User } from '../types';

const ROLES: Role[] = ['owner', 'manager', 'purchasing', 'receiving', 'stock', 'cashier', 'auditor'];

const emptyForm = { name: '', role: 'cashier' as Role, phone: '' };

export function UserFormModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user?: User | null;
}) {
  const { actions, currentUser } = useApp();
  const [form, setForm] = useState(emptyForm);

  const editingSelf = user?.id === currentUser.id;

  useEffect(() => {
    if (!open) return;
    setForm(user ? { name: user.name, role: user.role, phone: user.phone } : emptyForm);
  }, [open, user]);

  const submit = () => {
    const ok = user ? actions.updateUser(user.id, form) : actions.addUser(form);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? `Edit ${user.name}` : 'Add a user manually'}
      subtitle={
        user
          ? 'Update the name, role or phone. Every change is written to the audit trail.'
          : 'Creates the account immediately. The role sets the access boundary and is not a menu preference.'
      }
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={!form.name.trim() || !form.phone.trim()}>
            {user ? <Save size={16} /> : <UserPlus size={16} />}
            {user ? 'Save changes' : 'Create user'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="user-form-name">Full name <span className="req">*</span></label>
          <input
            id="user-form-name"
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Ada Nwosu"
          />
        </div>
        <div className="field">
          <label htmlFor="user-form-role">Role <span className="req">*</span></label>
          <select
            id="user-form-role"
            className="select"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            disabled={editingSelf}
          >
            {ROLES.map((role) => (
              <option key={role} value={role} disabled={role === 'owner' && currentUser.role !== 'owner'}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <span className="field__hint">
            {editingSelf ? 'You cannot change your own role.' : ROLE_DESCRIPTIONS[form.role]}
          </span>
        </div>
        <div className="field">
          <label htmlFor="user-form-phone">Phone <span className="req">*</span></label>
          <input
            id="user-form-phone"
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
