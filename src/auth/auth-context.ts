import { CurrentUser } from '../integration/admin/admin-service.client';

export interface AuthContext {
  accessToken: string;
  currentUser: CurrentUser;
}
