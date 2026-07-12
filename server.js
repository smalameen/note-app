require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Validate environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY in environment');
    process.exit(1);
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(express.static('public'));

// Initialize Supabase Client
const supabase = createClient(supabaseUrl, supabaseKey);

// Admin client for auth operations (uses service_role key)
const supabaseSecret = process.env.SUPABASE_SECRET_KEY;
const supabaseAdmin = supabaseSecret
    ? createClient(supabaseUrl, supabaseSecret, { auth: { autoRefreshToken: false, persistSession: false } })
    : null;

// --- Auth Middleware ---
async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    } catch (err) {
        next(err);
    }
}

// --- AUTH ROUTES ---

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) return res.status(400).json({ error: error.message });
        if (!data.user) return res.status(400).json({ error: 'Signup failed' });

        res.status(201).json({
            user: { id: data.user.id, email: data.user.email },
            session: data.session || null
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) return res.status(401).json({ error: error.message });
        if (!data.session) return res.status(401).json({ error: 'Login failed' });

        res.json({
            user: { id: data.user.id, email: data.user.email },
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at
            }
        });
    } catch (err) {
        next(err);
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authenticate, async (req, res, next) => {
    try {
        if (supabaseAdmin) {
            const { error } = await supabaseAdmin.auth.admin.signOut(req.user.id);
            if (error) console.error('Admin signOut error:', error.message);
        }
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// GET /api/auth/me
app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email } });
});

// --- Utility: check if error is about a missing column ---
function isMissingColumnError(error) {
    if (!error) return false;
    const msg = typeof error === 'string' ? error : (error.message || error.error || '');
    return msg.includes('does not exist') ||
        msg.includes('Could not find') ||
        msg.includes('schema cache') ||
        msg.includes('column') && msg.includes('not found');
}

// --- API ROUTES ---

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET: Fetch all notes (user-scoped, graceful fallback if user_id column missing)
app.get('/api/notes', authenticate, async (req, res, next) => {
    try {
        let query = supabase
            .from('notesupdated')
            .select('*')
            .order('created_at', { ascending: false });

        // Try user_id filter; if column missing, fall back to unfiltered
        const { data, error } = await query.eq('user_id', req.user.id);
        if (error && isMissingColumnError(error)) {
            const { data: fallback, error: fallbackErr } = await supabase
                .from('notesupdated')
                .select('*')
                .order('created_at', { ascending: false });
            if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
            return res.json(fallback);
        }
        if (error) return res.status(500).json({ error: error.message });
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// POST: Create a new note (user_id optional if column missing)
app.post('/api/notes', authenticate, async (req, res, next) => {
    try {
        const { title, content, is_folder, parent_id } = req.body;

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            return res.status(400).json({ error: 'Title is required' });
        }
        if (typeof is_folder !== 'boolean') {
            return res.status(400).json({ error: 'is_folder must be a boolean' });
        }
        if (parent_id !== undefined && parent_id !== null && typeof parent_id !== 'number') {
            return res.status(400).json({ error: 'parent_id must be a number or null' });
        }

        const insertData = { title: title.trim(), content: content || '', is_folder, parent_id: parent_id || null };
        // Try with user_id; if column missing, fall back
        const { data, error } = await supabase
            .from('notesupdated')
            .insert([{ ...insertData, user_id: req.user.id }])
            .select();

        if (error && isMissingColumnError(error)) {
            const { data: fallback, error: fallbackErr } = await supabase
                .from('notesupdated')
                .insert([insertData])
                .select();
            if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
            return res.status(201).json(fallback[0]);
        }
        if (error) return res.status(500).json({ error: error.message });
        res.status(201).json(data[0]);
    } catch (err) {
        next(err);
    }
});

// PUT: Update a note
app.put('/api/notes/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;

        if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanUpdateData = {};
        if (title !== undefined) cleanUpdateData.title = title.trim();
        if (content !== undefined) cleanUpdateData.content = content;

        let query = supabase
            .from('notesupdated')
            .update(cleanUpdateData)
            .eq('id', id)
            .select();

        // Try with user_id; if column missing, fall back
        let { data, error } = await query.eq('user_id', req.user.id);
        if (error && isMissingColumnError(error)) {
            const result = await supabase
                .from('notesupdated')
                .update(cleanUpdateData)
                .eq('id', id)
                .select();
            if (result.error) return res.status(500).json({ error: result.error.message });
            if (!result.data || result.data.length === 0) return res.status(404).json({ error: 'Note not found' });
            return res.json(result.data[0]);
        }
        if (error) return res.status(500).json({ error: error.message });
        if (!data || data.length === 0) return res.status(404).json({ error: 'Note not found' });

        res.json(data[0]);
    } catch (err) {
        next(err);
    }
});

// DELETE: Delete a note (blocks deletion of folders with children)
app.delete('/api/notes/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if this is a folder with children (try user_id, fall back)
        let childrenQuery = supabase
            .from('notesupdated')
            .select('id')
            .eq('parent_id', id);

        let { data: children, error: childError } = await childrenQuery.eq('user_id', req.user.id);
        if (childError && isMissingColumnError(childError)) {
            const fallback = await supabase
                .from('notesupdated')
                .select('id')
                .eq('parent_id', id);
            if (fallback.error) return res.status(500).json({ error: fallback.error.message });
            children = fallback.data;
        } else if (childError) {
            return res.status(500).json({ error: childError.message });
        }

        if (children && children.length > 0) {
            return res.status(409).json({
                error: 'Cannot delete folder with existing notes. Remove all items inside first.'
            });
        }

        // Delete (try user_id, fall back)
        let delQuery = supabase
            .from('notesupdated')
            .delete()
            .eq('id', id);

        let { error } = await delQuery.eq('user_id', req.user.id);
        if (error && isMissingColumnError(error)) {
            const fallback = await supabase
                .from('notesupdated')
                .delete()
                .eq('id', id);
            if (fallback.error) return res.status(500).json({ error: fallback.error.message });
            return res.json({ success: true });
        }
        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// --- Error handling middleware ---
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server (skip when deployed on Vercel)
if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}

module.exports = app;