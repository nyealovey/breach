import type { MetadataRoute } from 'next';

// The system is not publicly launched yet; block crawler indexing by default.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
