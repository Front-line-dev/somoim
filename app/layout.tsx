import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: '직접전송 — 화면과 대용량 파일을 P2P로',
  description: '화면, 시스템 소리, 마이크와 대용량 파일·폴더를 WebRTC로 직접 공유합니다.',
  openGraph: {
    title: '직접전송 — 화면과 대용량 파일을 P2P로',
    description: '서버 저장 없이 브라우저끼리 직접 연결하여 화면과 파일을 공유하세요.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '직접전송 — 화면과 대용량 파일을 P2P로' }],
  },
  twitter: { card: 'summary_large_image', title: '직접전송', description: 'WebRTC 화면 공유와 대용량 파일 전송', images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
