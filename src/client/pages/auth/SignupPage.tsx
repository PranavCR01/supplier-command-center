import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'

const signupSchema = z.object({
  company_name: z.string().min(2, 'Company name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type SignupFormData = z.infer<typeof signupSchema>

export default function SignupPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({ resolver: zodResolver(signupSchema) })

  const onSubmit = async (data: SignupFormData) => {
    setLoading(true)
    setError(null)

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: window.location.origin + '/auth/confirmed',
      },
    })

    setLoading(false)

    if (authError) {
      setError(authError.message)
      return
    }

    if (authData.user && authData.session) {
      // Email confirmation disabled — session available immediately
      await supabase.from('suppliers').insert({
        user_id: authData.user.id,
        company_name: data.company_name,
      })
      navigate('/profile')
      return
    }

    // Email confirmation required — show inline success state
    setSuccess(true)
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#0F172A]">Supplier Command Center</h1>
          <p className="text-[#334155] mt-1 text-sm">Powered by Valorant · Astra</p>
        </div>

        <Card className="shadow-md border-slate-200">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl text-[#0F172A]">Create your account</CardTitle>
            <CardDescription>Set up your supplier portal in seconds</CardDescription>
          </CardHeader>

          {success ? (
            <CardContent className="space-y-4 pb-6">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-4 text-sm text-emerald-800">
                <p className="font-medium mb-1">Check your email to confirm your account.</p>
                <p>Once confirmed, sign in to get started.</p>
              </div>
              <p className="text-sm text-center text-[#334155]">
                <Link to="/login" className="text-[#0369A1] font-medium hover:underline">
                  Go to sign in →
                </Link>
              </p>
            </CardContent>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="company_name">Company name</Label>
                  <Input
                    id="company_name"
                    type="text"
                    placeholder="Acme Tech Solutions Inc."
                    {...register('company_name')}
                  />
                  {errors.company_name && (
                    <p className="text-red-500 text-xs">{errors.company_name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    {...register('email')}
                  />
                  {errors.email && (
                    <p className="text-red-500 text-xs">{errors.email.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    {...register('password')}
                  />
                  {errors.password && (
                    <p className="text-red-500 text-xs">{errors.password.message}</p>
                  )}
                </div>
              </CardContent>

              <CardFooter className="flex flex-col gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0369A1] hover:bg-[#0284C7] text-white font-semibold cursor-pointer transition-all duration-200"
                >
                  {loading ? 'Creating account…' : 'Create account'}
                </Button>
                <p className="text-sm text-[#334155]">
                  Already have an account?{' '}
                  <Link to="/login" className="text-[#0369A1] font-medium hover:underline cursor-pointer">
                    Sign in
                  </Link>
                </p>
              </CardFooter>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
