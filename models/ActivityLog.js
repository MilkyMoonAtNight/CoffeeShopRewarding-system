const mongoose = require('mongoose');

// One collection that records everything that changes a customer's loyalty state:
//   drinks_added     → an admin recorded N drinks for a customer
//   reward_redeemed  → a free drink / special / merch / store voucher was claimed at the counter
//   voucher_redeemed → customer used a 7-day discount voucher
const activityLogSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['drinks_added', 'reward_redeemed', 'voucher_redeemed'],
    required: true
  },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  userName: { type: String, default: '' },     // cached so logs survive account deletion
  adminId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  adminName:{ type: String, default: '' },      // who did it ('Self service' for customer voucher redeems)
  quantity:  { type: Number, default: null },   // drinks_added only
  totalAfter:{ type: Number, default: null },   // customer's drink total after the action
  rewardType:        { type: String, default: null },
  rewardDescription: { type: String, default: null },
  at: { type: Date, default: Date.now, index: true }
});

activityLogSchema.index({ userId: 1, at: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
