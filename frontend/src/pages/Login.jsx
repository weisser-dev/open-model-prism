import { useState } from 'react';
import { TextInput, PasswordInput, Button, Paper, Title, Center, Stack, Alert, Container } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import api from '../hooks/useApi';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/prism/auth/login', { username, password });
      localStorage.setItem('token', data.token);
      onLogin({ id: data.id, username: data.username, role: data.role });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
    setLoading(false);
  }

  return (
    <Center h="100vh">
      <Container size="xs" w="100%">
        <Paper shadow="md" p="xl" radius="md" withBorder>
          <Title order={2} mb="lg" ta="center">Model Prism</Title>
          {error && <Alert icon={<IconAlertCircle />} color="red" mb="md">{error}</Alert>}
          <form onSubmit={handleLogin}>
            <Stack>
              <TextInput label="Username" value={username} onChange={e => setUsername(e.target.value)} required />
              <PasswordInput label="Password" value={password} onChange={e => setPassword(e.target.value)} required />
              <Button type="submit" loading={loading}>Login</Button>
            </Stack>
          </form>
        </Paper>
      </Container>
    </Center>
  );
}
