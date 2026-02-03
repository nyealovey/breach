#!/usr/bin/env python3
"""
WinRM client with Kerberos message encryption support.
Uses pywinrm which implements GSSAPI wrap/unwrap for encrypted sessions.

Usage:
    echo '{"host": "...", "username": "user@domain", "password": "...", "script": "..."}' | python3 winrm-kerberos.py
"""

import json
import os
import subprocess
import sys
import tempfile


def debug_log(message, data=None):
    """Print debug log to stderr"""
    log_entry = {"message": message}
    if data:
        log_entry["data"] = data
    print(f"[pywinrm-debug] {json.dumps(log_entry)}", file=sys.stderr)


def kinit_with_password(principal, password, timeout=30, enterprise=False):
    """
    Acquire Kerberos ticket using kinit with password.
    Returns the path to the credential cache file.
    """
    # Create a temporary directory for Kerberos credentials
    tmp_dir = tempfile.mkdtemp(prefix="pywinrm-krb-")
    ccache_path = os.path.join(tmp_dir, "ccache")
    password_file = os.path.join(tmp_dir, "password")

    # Set KRB5CCNAME BEFORE running kinit
    os.environ["KRB5CCNAME"] = f"FILE:{ccache_path}"

    try:
        # Write password to temp file
        with open(password_file, "w") as f:
            f.write(password + "\n")
        os.chmod(password_file, 0o600)

        # Environment for kinit
        env = os.environ.copy()

        # Try different principal formats
        principals_to_try = [principal]
        if "@" in principal:
            user, domain = principal.split("@", 1)
            # Also try uppercase domain
            principals_to_try.append(f"{user}@{domain.upper()}")

        last_error = None
        for princ in principals_to_try:
            debug_log("kinit.trying", {"principal": princ, "ccache": ccache_path})

            # Build kinit command
            kinit_args = ["kinit"]

            # Check if this is MIT Kerberos or Heimdal
            is_heimdal = sys.platform == "darwin"

            if is_heimdal:
                # Heimdal (macOS): use --password-file
                if enterprise:
                    kinit_args.append("--enterprise")
                kinit_args.extend(["--password-file=" + password_file, princ])
                stdin_input = None
            else:
                # MIT Kerberos: pipe password via stdin
                if enterprise:
                    kinit_args.append("-E")
                kinit_args.append(princ)
                stdin_input = password

            debug_log("kinit.command", {"args": kinit_args, "is_heimdal": is_heimdal, "env_KRB5CCNAME": env.get("KRB5CCNAME")})

            try:
                result = subprocess.run(
                    kinit_args,
                    input=stdin_input,
                    capture_output=True,
                    text=True,
                    timeout=timeout,
                    env=env
                )

                if result.returncode == 0:
                    # Verify ccache was created
                    if os.path.exists(ccache_path):
                        debug_log("kinit.success", {
                            "principal": princ,
                            "ccache": ccache_path,
                            "ccache_size": os.path.getsize(ccache_path)
                        })
                    else:
                        debug_log("kinit.success_but_no_ccache", {"principal": princ, "ccache": ccache_path})
                    return ccache_path, tmp_dir
                else:
                    last_error = result.stderr or result.stdout or f"exit code {result.returncode}"
                    debug_log("kinit.failed", {"principal": princ, "error": last_error})

            except subprocess.TimeoutExpired:
                last_error = "kinit timeout"
                debug_log("kinit.timeout", {"principal": princ})
            except Exception as e:
                last_error = str(e)
                debug_log("kinit.exception", {"principal": princ, "error": last_error})

        raise Exception(f"kinit failed for all principals: {last_error}")

    except Exception:
        # Cleanup on failure
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass
        raise


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"Invalid input JSON: {e}"}))
        return 1

    host = input_data.get("host", "").strip()
    port = input_data.get("port", 5985)
    use_https_raw = input_data.get("use_https", False)
    username = input_data.get("username", "").strip()
    password = input_data.get("password", "")
    script = input_data.get("script", "").strip()
    transport = input_data.get("transport", "kerberos")
    cert_validation = input_data.get("server_cert_validation", "ignore")

    # Coerce to bool (input may be bool or string).
    use_https = (
        use_https_raw
        if isinstance(use_https_raw, bool)
        else str(use_https_raw).strip().lower() in ("1", "true", "yes", "y", "on")
    )

    debug_log("input", {
        "host": host,
        "port": port,
        "use_https": use_https,
        "username": username,
        "transport": transport,
        "script_length": len(script),
        "kerberos_service_candidates": input_data.get("kerberos_service_candidates"),
        "kerberos_hostname_overrides": input_data.get("kerberos_hostname_overrides"),
    })

    if not host:
        print(json.dumps({"ok": False, "error": "Missing host"}))
        return 1
    if not username:
        print(json.dumps({"ok": False, "error": "Missing username"}))
        return 1
    if not script:
        print(json.dumps({"ok": False, "error": "Missing script"}))
        return 1

    tmp_dir = None
    ccache_path = None
    try:
        # First, acquire Kerberos ticket using kinit
        debug_log("kinit.start", {"username": username})
        ccache_path, tmp_dir = kinit_with_password(username, password, enterprise=("@" in username))

        debug_log("env.KRB5CCNAME", {"value": os.environ.get("KRB5CCNAME")})

        # Verify the ccache file exists and has content
        if os.path.exists(ccache_path):
            debug_log("ccache.verified", {"path": ccache_path, "size": os.path.getsize(ccache_path)})
        else:
            raise Exception(f"ccache file not found: {ccache_path}")

        # Now import winrm - AFTER setting KRB5CCNAME
        debug_log("winrm.import", {})
        try:
            import winrm
            debug_log("winrm.imported", {"version": getattr(winrm, "__version__", "unknown")})
        except ImportError as e:
            print(json.dumps({"ok": False, "error": f"pywinrm not installed: {e}"}))
            return 1

        # Create session with Kerberos transport
        scheme = "https" if use_https else "http"
        target = f"{scheme}://{host}:{port}/wsman"
        debug_log("session.create", {"target": target, "transport": transport})

        from winrm.vendor.requests_kerberos.exceptions import KerberosExchangeError

        # IMPORTANT:
        # When using a temporary ccache, Heimdal/MIT can normalize the principal
        # (e.g., realm casing). Passing an explicit principal to requests-kerberos
        # can then fail with "No credentials were supplied".
        #
        # Force requests-kerberos to use the *default* principal from the ccache
        # by creating our own Protocol with username=None (principal=None).
        from winrm.protocol import Protocol

        # The TS side decides SPN strategy (service candidates + hostname overrides) and passes them in.
        # Default should be strict: only one attempt (WSMAN + no hostname override).
        def uniq_list(values):
            seen = set()
            out = []
            for v in values:
                key = "__NONE__" if v is None else v
                if key in seen:
                    continue
                seen.add(key)
                out.append(v)
            return out

        raw_service_candidates = input_data.get("kerberos_service_candidates")
        if isinstance(raw_service_candidates, list):
            service_candidates = []
            for v in raw_service_candidates:
                if isinstance(v, str) and v.strip():
                    service_candidates.append(v.strip())
            if not service_candidates:
                service_candidates = ["WSMAN"]
        else:
            service_candidates = ["WSMAN"]

        raw_hostname_overrides = input_data.get("kerberos_hostname_overrides")
        if isinstance(raw_hostname_overrides, list):
            hostname_overrides = []
            for v in raw_hostname_overrides:
                if v is None:
                    hostname_overrides.append(None)
                elif isinstance(v, str) and v.strip():
                    hostname_overrides.append(v.strip())
            if not hostname_overrides:
                hostname_overrides = [None]
        else:
            hostname_overrides = [None]

        service_candidates = uniq_list(service_candidates)
        hostname_overrides = uniq_list(hostname_overrides)

        last_error = None
        result = None

        # Create a Session wrapper for run_ps convenience and override its protocol per attempt.
        session = winrm.Session(
            target=target,
            auth=(username, ""),  # Used for kinit only; protocol below uses ccache default principal.
            transport=transport,
            server_cert_validation=cert_validation,
        )

        for service_name in service_candidates:
            for hostname_override in hostname_overrides:
                debug_log("session.protocol.try", {
                    "principal": None,
                    "service": service_name,
                    "kerberos_hostname_override": hostname_override,
                })
                try:
                    protocol = Protocol(
                        target,
                        transport=transport,
                        username=None,
                        password=None,
                        server_cert_validation=cert_validation,
                        service=service_name,
                        kerberos_hostname_override=hostname_override,
                    )
                    session.protocol = protocol

                    # Run PowerShell script
                    debug_log("script.run", {"script_length": len(script)})
                    result = session.run_ps(script)
                    last_error = None
                    break
                except KerberosExchangeError as e:
                    last_error = e
                    debug_log("session.protocol.kerberos_error", {
                        "service": service_name,
                        "kerberos_hostname_override": hostname_override,
                        "error": str(e),
                    })
                    continue
            if result is not None:
                break

        if last_error is not None:
            raise last_error
        if result is None:
            raise Exception("pywinrm failed: no result returned")

        output = {
            "ok": True,
            "stdout": result.std_out.decode("utf-8", errors="replace") if result.std_out else "",
            "stderr": result.std_err.decode("utf-8", errors="replace") if result.std_err else "",
            "status_code": result.status_code,
        }
        debug_log("result", {
            "status_code": result.status_code,
            "stdout_length": len(output["stdout"]),
            "stderr_length": len(output["stderr"])
        })
        print(json.dumps(output))
        return 0 if result.status_code == 0 else 1

    except Exception as e:
        error_msg = str(e)
        error_type = type(e).__name__
        debug_log("error", {"error": error_msg, "type": error_type})

        # Try to get more details
        if hasattr(e, "response") and e.response is not None:
            error_msg = f"{error_msg} (HTTP {e.response.status_code})"
        if hasattr(e, "__cause__") and e.__cause__:
            error_msg = f"{error_msg} caused by: {e.__cause__}"

        print(json.dumps({"ok": False, "error": error_msg}))
        return 1

    finally:
        # Cleanup temporary directory
        if tmp_dir:
            try:
                import shutil
                shutil.rmtree(tmp_dir, ignore_errors=True)
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
