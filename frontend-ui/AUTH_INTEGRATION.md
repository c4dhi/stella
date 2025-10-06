# Real Authentication Integration - Complete

The dashboard now uses **real JWT-based authentication** with the session-management-server backend. Mock authentication has been completely removed.

## ✅ What Changed

### 1. **Real API Calls**
- `AuthService` now calls actual backend endpoints:
  - `POST /auth/signup` - Create new account
  - `POST /auth/login` - Login with credentials
  - `GET /auth/me` - Verify token and get user info

### 2. **JWT Token Management**
- Tokens stored in localStorage as `grace_auth_token`
- All API requests automatically include `Authorization: Bearer <token>`
- 401 errors trigger automatic logout and redirect to login

### 3. **Error Handling**
- Toast notification system for user-friendly error messages
- Specific error handling for common scenarios:
  - Invalid credentials
  - Email already exists
  - Network errors
  - Token expiration

### 4. **Token Injection**
- `ApiClient` automatically adds JWT to all requests
- No manual token management needed
- Automatic redirect to login on 401 Unauthorized

## 🔧 How to Use

### Prerequisites

**Session Management Server must be running** with auth enabled:

```bash
cd session-management-server
npm run start:dev
```

The server should be at `http://localhost:3000` with:
- `/auth/signup` endpoint available
- `/auth/login` endpoint available
- `/auth/me` endpoint available
- JWT authentication enabled

### Sign Up

1. Visit `http://localhost:5173`
2. Click "Don't have an account? Sign up"
3. Enter:
   - **Name**: Your name
   - **Email**: Valid email address
   - **Password**: Password (6+ characters)
4. Click "Create Account"
5. If successful, you'll be logged in and redirected to dashboard

### Login

1. Visit `http://localhost:5173/login`
2. Enter your email and password
3. Click "Sign In"
4. If successful, redirected to dashboard

### What Happens Behind the Scenes

```typescript
// 1. User submits login form
const { user, tokens } = await authService.login({ email, password })

// 2. Server returns:
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2025-10-03T..."
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}

// 3. Token stored in localStorage
localStorage.setItem('grace_auth_token', token)

// 4. All subsequent API calls include token:
fetch('/projects', {
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIs...'
  }
})
```

## 🔒 Security Features

### Token Storage
- JWT stored in localStorage as `grace_auth_token`
- User info stored as `grace_user`
- Automatically cleared on logout or 401 error

### Token Expiration
- Tokens expire after 7 days (backend configured)
- On expiration, user automatically redirected to login
- Clear error message shown

### Automatic Logout
- 401 errors trigger immediate logout
- Auth data cleared from localStorage
- User redirected to `/login`

## 🎨 Error Messages

The system shows user-friendly toast notifications for all errors:

### Login Errors
- ❌ "Invalid email or password" - Wrong credentials
- ❌ "Unable to connect to server" - Network error
- ❌ "Session expired. Please login again." - Token expired

### Signup Errors
- ❌ "Email already registered" - Duplicate email
- ❌ "Failed to create account" - Generic error
- ❌ Validation errors shown inline on form

### API Errors
- ❌ Auto-logout on 401 Unauthorized
- ❌ Toast notification for failed operations
- ✅ Success toasts for create/delete operations

## 📝 Testing the Integration

### 1. Test Signup Flow

```bash
# Start the frontend
npm run dev

# In browser:
# 1. Go to http://localhost:5173
# 2. Click "Sign up"
# 3. Enter: name, email, password
# 4. Submit
# 5. Should see dashboard with welcome toast
```

### 2. Test Login Flow

```bash
# Use an existing account from step 1
# 1. Logout
# 2. Go to /login
# 3. Enter credentials
# 4. Should login and see dashboard
```

### 3. Test Token Expiration

```bash
# Manually expire token:
# 1. Open browser DevTools → Application → localStorage
# 2. Delete 'grace_auth_token'
# 3. Try to create a project
# 4. Should redirect to login with error message
```

### 4. Test Invalid Credentials

```bash
# 1. Go to /login
# 2. Enter wrong email/password
# 3. Should see error toast: "Invalid email or password"
```

## 🔍 File Changes Summary

### Modified Files

1. **`src/services/AuthService.ts`**
   - Removed mock authentication
   - Added real API calls to `/auth/*` endpoints
   - Proper error handling and messages

2. **`src/services/ApiClient.ts`**
   - Auto-inject JWT token from localStorage
   - Handle 401 errors with redirect
   - Improved error handling

3. **`src/store/authStore.ts`**
   - Added `getMe()` call to verify token
   - Updated `checkAuth()` to validate token on mount

4. **`src/pages/LoginPage.tsx`**
   - Removed "demo mode" message
   - Real validation errors displayed

### New Files

5. **`src/components/Toast.tsx`**
   - Toast notification component
   - Success/error/info variants
   - Auto-dismiss after 5 seconds

6. **`src/store/toastStore.ts`**
   - Global toast state management
   - Add/remove toast methods

7. **`src/App.tsx`**
   - Added ToastContainer for global notifications

## 🚀 Production Checklist

Before deploying to production:

- [ ] Update `VITE_API_URL` in `.env.local` to production URL
- [ ] Ensure HTTPS for API endpoint
- [ ] Enable CORS on backend for your frontend domain
- [ ] Consider implementing refresh tokens
- [ ] Add rate limiting on auth endpoints
- [ ] Implement password strength validation
- [ ] Add email verification (optional)
- [ ] Set up password reset flow (optional)

## 🐛 Troubleshooting

### "Unable to connect to server"

**Cause**: Session management server not running or wrong URL

**Fix**:
```bash
# Check server is running
cd session-management-server
npm run start:dev

# Verify URL in .env.local
VITE_API_URL=http://localhost:3000  # Should match server
```

### "Session expired" immediately after login

**Cause**: Token validation failing

**Fix**:
- Check JWT_SECRET matches between frontend/backend
- Verify server's JWT configuration
- Check server logs for errors

### Can't create projects after login

**Cause**: Projects not filtered by user

**Fix**: Backend needs to implement user-project associations (see `AUTH_IMPLEMENTATION.md` in server repo)

## 📚 Related Documentation

- **Backend Auth**: `session-management-server/AUTH_IMPLEMENTATION.md`
- **Dashboard Guide**: `DASHBOARD_GUIDE.md`
- **API Types**: `src/lib/api-types.ts`

---

**Authentication is now fully integrated!** Users must create accounts and login with real credentials to use the dashboard.
