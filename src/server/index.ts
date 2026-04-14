import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import suppliersRouter from './routes/suppliers'
import { errorHandler } from './middleware/error'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(helmet())
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : true }))
app.use(morgan('dev'))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/api/suppliers', suppliersRouter)

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
