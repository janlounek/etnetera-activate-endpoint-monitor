const express = require('express');
const router = express.Router();
const db = require('../../db/database');
const { CHECKER_LABELS } = require('../checkers');

router.get('/', (req, res) => {
  res.render('index', { checkerLabels: CHECKER_LABELS });
});

router.get('/sites/new', (req, res) => {
  res.render('site-form', { site: null, checkerLabels: CHECKER_LABELS });
});

router.get('/sites/:id', (req, res) => {
  const site = db.getSiteById(parseInt(req.params.id));
  if (!site) return res.redirect('/');
  res.render('site-detail', { site, checkerLabels: CHECKER_LABELS });
});

router.get('/sites/:id/edit', (req, res) => {
  const site = db.getSiteById(parseInt(req.params.id));
  if (!site) return res.redirect('/');
  res.render('site-form', { site, checkerLabels: CHECKER_LABELS });
});

router.get('/settings', (req, res) => {
  res.render('settings');
});

module.exports = router;
