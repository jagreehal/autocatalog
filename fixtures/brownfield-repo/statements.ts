import mongoose from 'mongoose';

const statementSchema = new mongoose.Schema(
  { customerId: { type: String, required: true }, amount: { type: Number, required: true } },
  { collection: 'statements' },
);

export const Statement = mongoose.model('Statement', statementSchema);

export async function generateStatement(customerId: string, amount: number) {
  return Statement.create({ customerId, amount });
}
