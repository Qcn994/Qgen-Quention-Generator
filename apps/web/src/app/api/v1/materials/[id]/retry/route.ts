import { retryResponseSchema } from '@qgen/contracts';

import { getContainer } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 只重试失败的阶段：UPDATE 原 job 放回队列，不新建任务、不放宽唯一索引。
 * 前端在材料 failed 后显示「重试」按钮调用这里。
 *
 * 语义（计划第十五节「D2 重试设计」）：attempt 不清零，**每次手工重试 = +1 次尝试**。
 * worker 的自动重试预算仍是 attempt < 2；手工重试是用户每次知情点击，给一次新机会，
 * 不是 bug，也不要"顺手"把 attempt 归零——那会让每次点击都重新获得整份重试预算。
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const result = await getContainer().retryMaterial.execute(id);

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return Response.json(
        { error: { code: 'not_found', message: '材料不存在' } },
        { status: 404 },
      );
    }
    return Response.json(
      { error: { code: 'no_failed_stage', message: '没有可重试的失败阶段' } },
      { status: 409 },
    );
  }

  return Response.json(
    retryResponseSchema.parse({
      id: result.material.id,
      status: result.material.status,
      stage: result.stage,
    }),
  );
}
