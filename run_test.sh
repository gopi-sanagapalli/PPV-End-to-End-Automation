#!/bin/bash
cd /Users/Hari.Prasad/jobbot/dazn-tests
export DAZN_ENV=prod
export DAZN_REGION=GB
export PLAN=standard_monthly
export SOURCE=home-page-live-tv-rail
npx playwright test tests/new_user/newuser.ppv.spec.ts --headed 2>&1 | tee test_output.log
