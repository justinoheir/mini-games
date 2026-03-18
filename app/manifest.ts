import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ether Glimmers',
    short_name: 'Glimmers',
    description: 'Interactive experiences by Ether — feel the moment, measure the magic.',
    start_url: '/',
    display: 'standalone',
    background_color: '#08090f',
    theme_color: '#08090f',
    orientation: 'portrait',
    categories: ['games', 'entertainment'],
    icons: [
      {
        src: '/icons/icon-192.jpg',
        sizes: '192x192',
        type: 'image/jpeg',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.jpg',
        sizes: '512x512',
        type: 'image/jpeg',
        purpose: 'any',
      },
    ],
  }
}
