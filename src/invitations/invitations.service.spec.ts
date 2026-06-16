// InvitationsService pulls in LiveKitService / AuthService whose transitive deps
// are ESM-only (livekit-server-sdk) and trip ts-jest. create() only needs a stub
// of each, so cut those module subtrees at the boundary.
jest.mock('../livekit/livekit.service', () => ({ LiveKitService: class {} }));
jest.mock('../auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('livekit-server-sdk', () => ({ TokenVerifier: class {}, AccessToken: class {} }));

import { InvitationsService } from './invitations.service';

type SessionRow = {
  id: string;
  status: 'ACTIVE' | 'CLOSING' | 'CLOSED';
  room?: { id: string } | null;
};

function setup(session: SessionRow) {
  const prisma: any = {
    session: {
      findUnique: jest.fn(async () => session),
      update: jest.fn(async () => ({})),
    },
    invitation: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({
        id: 'inv1',
        token: 'tok',
        ...data,
      })),
    },
  };
  const livekit: any = {};
  const authService: any = {};
  const configService: any = { get: jest.fn(() => 'http://localhost:8080') };
  const service = new InvitationsService(prisma, livekit, authService, configService);
  return { service, prisma };
}

describe('InvitationsService.create — max-duration cap propagation (#198)', () => {
  const activeSession: SessionRow = { id: 's1', status: 'ACTIVE', room: { id: 'r1' } };

  it('propagates an invitation cap onto the session so the timer can arm', async () => {
    const { service, prisma } = setup(activeSession);

    await service.create('s1', { maxSessionDurationSeconds: 600 } as any);

    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxSessionDurationSeconds: 600 }),
      }),
    );
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { maxSessionDurationSeconds: 600 },
    });
  });

  it('leaves the session uncapped when no cap is supplied', async () => {
    const { service, prisma } = setup(activeSession);

    await service.create('s1', {} as any);

    expect(prisma.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxSessionDurationSeconds: null }),
      }),
    );
    expect(prisma.session.update).not.toHaveBeenCalled();
  });
});
