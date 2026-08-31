export const signalSchema = `
CREATE TABLE IF NOT EXISTS signals (
  room TEXT PRIMARY KEY,
  offer TEXT NOT NULL,
  answer TEXT,
  created_at INTEGER NOT NULL
)
`;

