const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['owner', 'manager', 'barista'],
    default: 'barista'
  },
  active: { type: Boolean, default: true },
  lastLogin: Date,
  createdAt:   { type: Date, default: Date.now },
  checkedIn:  { type: Boolean, default: false }
});

// Role permissions helper
adminSchema.methods.can = function (action) {
  const permissions = {
    owner:   ['scan', 'manage_menu', 'manage_events', 'manage_staff', 'view_stats', 'manage_users'],
    manager: ['scan', 'manage_menu', 'manage_events', 'view_stats'],
    barista: ['scan']
  };
  return permissions[this.role]?.includes(action) ?? false;
};

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

adminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

module.exports = mongoose.model('Admin', adminSchema);
