/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.cache = false; // disable filesystem cache that is timing out
    }
    return config;
  },
};

module.exports = nextConfig;