import { pageActor } from '@/server/session';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function WorkspaceLayout({children}:{children:React.ReactNode}) { return <Shell actor={await pageActor()}>{children}</Shell>; }
