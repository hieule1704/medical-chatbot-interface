import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: undefined,
  serverExternalPackages: ['chromadb', 'better-sqlite3'],
}

export default nextConfig