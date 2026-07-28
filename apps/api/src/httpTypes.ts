export type UserIdentity = {
  id: string;
  email: string | null;
};

export type ApiHonoEnv = {
  Variables: {
    requestId: string;
    user: UserIdentity;
    adminEmail: string | null;
    isAdmin: boolean;
    logStage: string | null;
  };
};
