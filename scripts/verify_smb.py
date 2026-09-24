"""One encrypted SMB session; credentials only on stdin, no output or file access."""
import json
import logging
import sys
import uuid

logging.disable(logging.CRITICAL)


def main():
    from smbprotocol.connection import Connection, Dialects
    from smbprotocol.session import Session

    data = json.loads(sys.stdin.buffer.read(4096))
    connection = Connection(uuid.uuid4(), data['host'], 445, require_signing=True)
    try:
        connection.connect(dialect=Dialects.SMB_3_1_1, timeout=8)
        session = Session(connection, username=data['username'], password=data['password'],
                          require_encryption=True, auth_protocol='ntlm')
        session.connect()
        # Guest/anonymous fallback is not proof of knowing a user's password.
        if not session.session_key or not session.encrypt_data:
            return 1
        session.disconnect()
        return 0
    finally:
        connection.disconnect()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BaseException:
        sys.exit(1)
