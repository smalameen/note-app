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

// --- API ROUTES ---

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET: Fetch all notes
app.get('/api/notes', async (req, res, next) => {
    try {
        const { data, error } = await supabase
            .from('notesupdated')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// POST: Create a new note
app.post('/api/notes', async (req, res, next) => {
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

        const { data, error } = await supabase
            .from('notesupdated')
            .insert([{ title: title.trim(), content: content || '', is_folder, parent_id: parent_id || null }])
            .select();

        if (error) return res.status(500).json({ error: error.message });
        res.status(201).json(data[0]);
    } catch (err) {
        next(err);
    }
});

// PUT: Update a note
app.put('/api/notes/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;

        if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
            return res.status(400).json({ error: 'Title cannot be empty' });
        }

        const cleanUpdateData = {};
        if (title !== undefined) cleanUpdateData.title = title.trim();
        if (content !== undefined) cleanUpdateData.content = content;

        const { data, error } = await supabase
            .from('notesupdated')
            .update(cleanUpdateData)
            .eq('id', id)
            .select();

        if (error) return res.status(500).json({ error: error.message });
        if (!data || data.length === 0) return res.status(404).json({ error: 'Note not found' });

        res.json(data[0]);
    } catch (err) {
        next(err);
    }
});

// DELETE: Delete a note (blocks deletion of folders with children)
app.delete('/api/notes/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if this is a folder with children
        const { data: children, error: childError } = await supabase
            .from('notesupdated')
            .select('id')
            .eq('parent_id', id);

        if (childError) return res.status(500).json({ error: childError.message });

        if (children && children.length > 0) {
            return res.status(409).json({
                error: 'Cannot delete folder with existing notes. Remove all items inside first.'
            });
        }

        const { error } = await supabase
            .from('notesupdated')
            .delete()
            .eq('id', id);

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