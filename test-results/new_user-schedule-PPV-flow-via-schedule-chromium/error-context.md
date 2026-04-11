# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: new_user/schedule.spec.ts >> PPV flow via schedule
- Location: tests/new_user/schedule.spec.ts:26:5

# Error details

```
Test timeout of 240000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e9]:
    - generic [ref=e11]:
      - button [ref=e13]:
        - img [ref=e15] [cursor=pointer]
      - heading "Choose your plan" [level=1] [ref=e17]:
        - paragraph [ref=e20]: Choose your plan
    - generic [ref=e28]:
      - group [ref=e30]:
        - paragraph [ref=e35]:
          - text: Buy
          - strong [ref=e36]: Wardley vs. Dubois
          - text: with DAZN Standard or
          - strong [ref=e37]: get it included in DAZN Ultimate.
        - button "ppv t wardley dubois Sat 9th May at 23:30 Wardley vs. Dubois ₹1,812" [ref=e38]:
          - generic [ref=e39]:
            - img "ppv t wardley dubois" [ref=e40]
            - generic [ref=e41]: Sat 9th May at 23:30
          - generic [ref=e43]:
            - generic [ref=e44]:
              - text: Wardley vs. Dubois
              - paragraph [ref=e47]: ₹1,812
            - img [ref=e50] [cursor=pointer]
        - generic [ref=e54]:
          - separator [ref=e55]
          - generic [ref=e56]: Choose your subscription
        - generic [ref=e57]:
          - radio "7-day free trial of DAZN Standard selected tick-golden 7-days free access to DAZN Standard. tick-golden Cancel anytime during the trial and only pay for the fight. After the trial you move onto a Monthly Flex plan for ₹799/month. You will not lose access to the pay-per-view[s]." [checked]
          - generic [ref=e59] [cursor=pointer]:
            - generic [ref=e60]:
              - paragraph [ref=e65]:
                - strong [ref=e66]: 7-day free trial
                - text: of DAZN Standard
              - img "selected" [ref=e69]
            - separator [ref=e70]
            - list [ref=e71]:
              - listitem [ref=e72]:
                - paragraph [ref=e73]:
                  - img "tick-golden" [ref=e74]
                - paragraph [ref=e76]:
                  - strong [ref=e77]: 7-days free access to DAZN Standard
                  - text: .
              - listitem [ref=e78]:
                - paragraph [ref=e79]:
                  - img "tick-golden" [ref=e80]
                - paragraph [ref=e82]: Cancel anytime during the trial and only pay for the fight. After the trial you move onto a Monthly Flex plan for ₹799/month. You will not lose access to the pay-per-view[s].
        - generic [ref=e83] [cursor=pointer]:
          - radio "DAZN Ultimate From ₹1,775 / month Annual contract. Auto renews. ppv t wardley dubois Wardley vs. Dubois Sat 9th May at 23:30 tick icon Included tick-golden Pay-per-views included at no extra cost. Minimum of 12 events per year including Chisora vs. Wilder & Wardley vs. Dubois. tick-golden HDR and Dolby 5.1 surround sound on select events. tick-golden 185+ fights a year from the best promoters Whats included"
          - paragraph [ref=e84]:
            - paragraph [ref=e86]: Pay-per-views included
          - generic [ref=e88]:
            - generic [ref=e89]:
              - paragraph [ref=e94]: DAZN Ultimate
              - generic [ref=e97]:
                - generic [ref=e100]:
                  - generic [ref=e101]: From
                  - generic [ref=e102]: ₹1,775
                  - generic [ref=e103]: / month
                - generic:
                  - generic:
                    - paragraph
                - paragraph [ref=e106]: Annual contract. Auto renews.
            - generic [ref=e110]:
              - img "ppv t wardley dubois" [ref=e112]
              - generic [ref=e113]:
                - generic [ref=e115]: Wardley vs. Dubois
                - generic [ref=e116]: Sat 9th May at 23:30
                - generic [ref=e117]:
                  - img "tick icon" [ref=e118]
                  - paragraph [ref=e119]: Included
            - generic [ref=e120]:
              - generic [ref=e121]:
                - img "tick-golden" [ref=e122]
                - paragraph [ref=e123]:
                  - paragraph [ref=e125]:
                    - text: Pay-per-views included at no extra cost. Minimum of 12 events per year including
                    - strong [ref=e126]: Chisora vs. Wilder & Wardley vs. Dubois.
              - generic [ref=e127]:
                - img "tick-golden" [ref=e128]
                - paragraph [ref=e129]:
                  - paragraph [ref=e131]: HDR and Dolby 5.1 surround sound on select events.
              - generic [ref=e132]:
                - img "tick-golden" [ref=e133]
                - paragraph [ref=e134]:
                  - paragraph [ref=e136]: 185+ fights a year from the best promoters
            - generic [ref=e137]:
              - heading "Whats included" [level=4] [ref=e138]
              - img [ref=e140]
      - button "Continue with PPV + 7-day free trial" [ref=e143] [cursor=pointer]:
        - paragraph [ref=e146]:
          - paragraph [ref=e149]:
            - text: Continue with
            - strong [ref=e150]: PPV + 7-day
            - text: free trial
  - iframe [ref=e151]:
    
```