import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { db } from "./db"
import { users } from "./db/schema"
import { eq } from "drizzle-orm"

declare module "next-auth" {
  interface User {
    role: string
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: string
      image?: string | null
    }
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials?.password) return null
        const email = credentials.email as string
        const password = credentials.password as string
        const user = await db.select().from(users).where(eq(users.email, email)).get()
        if (!user) return null
        const ok = await bcrypt.compare(password, user.password)
        if (!ok) return null
        return { id: String(user.id), email: user.email, name: user.name, role: user.role }
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id
        token.role = (user as { role?: string }).role
      }
      return token
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = String(token.id)
        session.user.role = String(token.role ?? "retoucher")
      }
      return session
    },
  },
})