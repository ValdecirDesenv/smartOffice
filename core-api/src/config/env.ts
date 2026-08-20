function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'),
  uploadsDir: process.env.UPLOADS_DIR ?? '/data/uploads',
};
