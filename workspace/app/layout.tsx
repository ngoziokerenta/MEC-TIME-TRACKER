import type { Metadata } from "next";


export const metadata: Metadata = {
  title: "MEC Workspace",
  description: "Private MEC workspace for Clocker, Coaching Accountable and assessment tools.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
