import { getContainer } from '@/server/container';
import { toProgressResponse } from '@/server/dto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const progress = await getContainer().getMaterialProgress.execute(id);

  if (progress === null) {
    return Response.json(
      { error: { code: 'not_found', message: '材料不存在' } },
      { status: 404 },
    );
  }

  return Response.json(toProgressResponse(progress));
}
