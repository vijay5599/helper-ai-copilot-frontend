/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  transpilePackages: ['react-markdown', 'remark-gfm'],
  turbopack: {},
  webpack: (config) => {
    config.externals = [...(config.externals || []), 'electron'];
    return config;
  },
};

export default nextConfig;
